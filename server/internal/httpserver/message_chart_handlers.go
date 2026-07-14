package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
)

const (
	chartTypeLine  = "line"
	chartTypeBar   = "bar"
	chartTypePie   = "pie"
	chartTypeRadar = "radar"

	chartBarDirectionHorizontal = "horizontal"
	chartBarDirectionVertical   = "vertical"
	chartBarModeGrouped         = "grouped"
	chartBarModeStacked         = "stacked"

	maxChartMessageBodyBytes  = 64 * 1024
	maxChartTitleLength       = 16
	maxChartDescriptionLength = 128
	maxChartLabelLength       = 64
	maxChartLabels            = 100
	maxChartSeries            = 5
	maxChartValue             = 1_000_000_000_000_000
	maxChartCartesianPoints   = maxChartLabels * maxChartSeries
	maxChartPieItems          = 5
	minChartRadarAxes         = 3
	maxChartRadarAxes         = 12
	messageTypeChart          = "chart"
)

type chartMessageBody struct {
	Type        string          `json:"type"`
	ChartType   string          `json:"chart_type"`
	Title       string          `json:"title"`
	Data        json.RawMessage `json:"data"`
	Description string          `json:"description"`
}

type chartCartesianData struct {
	Labels []string      `json:"labels"`
	Series []chartSeries `json:"series"`
}

type chartBarData struct {
	Direction string        `json:"direction"`
	Mode      string        `json:"mode"`
	Labels    []string      `json:"labels"`
	Series    []chartSeries `json:"series"`
}

type chartSeries struct {
	Name   string     `json:"name"`
	Values []*float64 `json:"values"`
}

type chartPieData struct {
	Items []chartPieItem `json:"items"`
}

type chartPieItem struct {
	Name  string  `json:"name"`
	Value float64 `json:"value"`
}

type chartRadarData struct {
	Axes   []chartRadarAxis `json:"axes"`
	Series []chartSeries    `json:"series"`
}

type chartRadarAxis struct {
	Name string  `json:"name"`
	Max  float64 `json:"max"`
}

type chartMessageBodyHandler struct{}

func (chartMessageBodyHandler) Type() string {
	return messageTypeChart
}

func (handler chartMessageBodyHandler) Validate(raw json.RawMessage) error {
	_, err := handler.decodeAndNormalize(raw)
	return err
}

func (handler chartMessageBodyHandler) Normalize(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	body, err := handler.decodeAndNormalize(raw)
	if err != nil {
		return nil, err
	}
	return json.Marshal(body)
}

func (chartMessageBodyHandler) Summary(raw json.RawMessage) (string, error) {
	var body chartMessageBody
	if err := decodeStrictChartJSON(raw, &body); err != nil {
		return "", errors.New("图表消息格式错误")
	}
	return "[图表] " + strings.TrimSpace(body.Title), nil
}

func (handler chartMessageBodyHandler) decodeAndNormalize(raw json.RawMessage) (chartMessageBody, error) {
	if len(raw) > maxChartMessageBodyBytes {
		return chartMessageBody{}, errors.New("图表消息不能超过 64 KiB")
	}

	var body chartMessageBody
	if err := decodeStrictChartJSON(raw, &body); err != nil {
		return chartMessageBody{}, errors.New("图表消息格式错误")
	}
	if strings.TrimSpace(body.Type) != handler.Type() {
		return chartMessageBody{}, errors.New("消息类型错误")
	}
	body.Type = handler.Type()
	body.ChartType = strings.TrimSpace(body.ChartType)
	body.Title = strings.TrimSpace(body.Title)
	body.Description = strings.TrimSpace(body.Description)
	if body.Title == "" {
		return chartMessageBody{}, errors.New("图表标题不能为空")
	}
	if len([]rune(body.Title)) > maxChartTitleLength {
		return chartMessageBody{}, errors.New("图表标题不能超过 16 个字符")
	}
	if body.Description == "" {
		return chartMessageBody{}, errors.New("图表描述不能为空")
	}
	if len([]rune(body.Description)) > maxChartDescriptionLength {
		return chartMessageBody{}, errors.New("图表描述不能超过 128 个字符")
	}
	if len(body.Data) == 0 || string(body.Data) == "null" {
		return chartMessageBody{}, errors.New("图表数据不能为空")
	}

	normalizedData, err := normalizeChartData(body.ChartType, body.Data)
	if err != nil {
		return chartMessageBody{}, err
	}
	body.Data = normalizedData
	return body, nil
}

func normalizeChartData(chartType string, raw json.RawMessage) (json.RawMessage, error) {
	switch chartType {
	case chartTypeLine:
		var data chartCartesianData
		if err := decodeStrictChartJSON(raw, &data); err != nil {
			return nil, errors.New("折线图数据格式错误")
		}
		if err := normalizeCartesianChartData(&data.Labels, data.Series, 2); err != nil {
			return nil, err
		}
		return json.Marshal(data)
	case chartTypeBar:
		var data chartBarData
		if err := decodeStrictChartJSON(raw, &data); err != nil {
			return nil, errors.New("条形图数据格式错误")
		}
		data.Direction = strings.TrimSpace(data.Direction)
		if data.Direction != chartBarDirectionHorizontal && data.Direction != chartBarDirectionVertical {
			return nil, errors.New("条形图方向必须是 horizontal 或 vertical")
		}
		data.Mode = strings.TrimSpace(data.Mode)
		if data.Mode != chartBarModeGrouped && data.Mode != chartBarModeStacked {
			return nil, errors.New("条形图排列方式必须是 grouped 或 stacked")
		}
		if err := normalizeCartesianChartData(&data.Labels, data.Series, 1); err != nil {
			return nil, err
		}
		if data.Mode == chartBarModeStacked {
			if err := validateChartStackedTotals(data.Series, len(data.Labels)); err != nil {
				return nil, err
			}
		}
		return json.Marshal(data)
	case chartTypePie:
		var data chartPieData
		if err := decodeStrictChartJSON(raw, &data); err != nil {
			return nil, errors.New("饼图数据格式错误")
		}
		if len(data.Items) < 2 || len(data.Items) > maxChartPieItems {
			return nil, fmt.Errorf("饼图项目数量必须在 2 到 %d 之间", maxChartPieItems)
		}
		seen := make(map[string]struct{}, len(data.Items))
		total := 0.0
		for index := range data.Items {
			item := &data.Items[index]
			item.Name = strings.TrimSpace(item.Name)
			if err := validateChartName(item.Name, "饼图项目名称"); err != nil {
				return nil, err
			}
			if _, ok := seen[item.Name]; ok {
				return nil, errors.New("饼图项目名称不能重复")
			}
			seen[item.Name] = struct{}{}
			if !isFiniteChartNumber(item.Value) || item.Value <= 0 || item.Value > maxChartValue {
				return nil, fmt.Errorf("饼图数值必须大于 0 且不能超过 %.0f", float64(maxChartValue))
			}
			total += item.Value
		}
		if !isFiniteChartNumber(total) {
			return nil, errors.New("饼图数值总和必须是有限数字")
		}
		return json.Marshal(data)
	case chartTypeRadar:
		var data chartRadarData
		if err := decodeStrictChartJSON(raw, &data); err != nil {
			return nil, errors.New("雷达图数据格式错误")
		}
		if len(data.Axes) < minChartRadarAxes || len(data.Axes) > maxChartRadarAxes {
			return nil, fmt.Errorf("雷达图维度数量必须在 %d 到 %d 之间", minChartRadarAxes, maxChartRadarAxes)
		}
		axisNames := make(map[string]struct{}, len(data.Axes))
		for index := range data.Axes {
			axis := &data.Axes[index]
			axis.Name = strings.TrimSpace(axis.Name)
			if err := validateChartName(axis.Name, "雷达图维度名称"); err != nil {
				return nil, err
			}
			if _, ok := axisNames[axis.Name]; ok {
				return nil, errors.New("雷达图维度名称不能重复")
			}
			axisNames[axis.Name] = struct{}{}
			if !isFiniteChartNumber(axis.Max) || axis.Max <= 0 || axis.Max > maxChartValue {
				return nil, fmt.Errorf("雷达图维度最大值必须大于 0 且不能超过 %.0f", float64(maxChartValue))
			}
		}
		if err := normalizeChartSeries(data.Series, len(data.Axes), false); err != nil {
			return nil, err
		}
		for _, series := range data.Series {
			for index, value := range series.Values {
				if value == nil {
					return nil, errors.New("雷达图数值不能为空")
				}
				if *value < 0 || *value > data.Axes[index].Max {
					return nil, errors.New("雷达图数值必须在 0 和对应维度最大值之间")
				}
			}
		}
		return json.Marshal(data)
	default:
		return nil, errors.New("图表类型必须是 line、bar、pie 或 radar")
	}
}

func normalizeCartesianChartData(labels *[]string, series []chartSeries, minLabels int) error {
	if len(*labels) < minLabels || len(*labels) > maxChartLabels {
		return fmt.Errorf("图表标签数量必须在 %d 到 %d 之间", minLabels, maxChartLabels)
	}
	for index := range *labels {
		label := strings.TrimSpace((*labels)[index])
		if err := validateChartName(label, "图表标签"); err != nil {
			return err
		}
		(*labels)[index] = label
	}
	if len(*labels)*len(series) > maxChartCartesianPoints {
		return fmt.Errorf("图表数据点不能超过 %d 个", maxChartCartesianPoints)
	}
	return normalizeChartSeries(series, len(*labels), true)
}

func normalizeChartSeries(series []chartSeries, valueCount int, allowNull bool) error {
	if len(series) < 1 || len(series) > maxChartSeries {
		return fmt.Errorf("图表系列数量必须在 1 到 %d 之间", maxChartSeries)
	}
	seen := make(map[string]struct{}, len(series))
	for index := range series {
		current := &series[index]
		current.Name = strings.TrimSpace(current.Name)
		if err := validateChartName(current.Name, "图表系列名称"); err != nil {
			return err
		}
		if _, ok := seen[current.Name]; ok {
			return errors.New("图表系列名称不能重复")
		}
		seen[current.Name] = struct{}{}
		if len(current.Values) != valueCount {
			return errors.New("图表系列数值数量必须与标签或维度数量一致")
		}
		hasValue := false
		for _, value := range current.Values {
			if value == nil {
				if allowNull {
					continue
				}
				return errors.New("图表系列数值不能为空")
			}
			if !isFiniteChartNumber(*value) || math.Abs(*value) > maxChartValue {
				return fmt.Errorf("图表系列数值绝对值不能超过 %.0f", float64(maxChartValue))
			}
			hasValue = true
		}
		if !hasValue {
			return errors.New("图表系列至少需要一个有效数值")
		}
	}
	return nil
}

func validateChartStackedTotals(series []chartSeries, valueCount int) error {
	for valueIndex := 0; valueIndex < valueCount; valueIndex++ {
		positiveTotal := 0.0
		negativeTotal := 0.0
		for _, current := range series {
			value := current.Values[valueIndex]
			if value == nil {
				continue
			}
			if *value >= 0 {
				positiveTotal += *value
			} else {
				negativeTotal += *value
			}
		}
		if !isFiniteChartNumber(positiveTotal) || !isFiniteChartNumber(negativeTotal) {
			return errors.New("堆叠条形图数值总和必须是有限数字")
		}
	}
	return nil
}

func validateChartName(value string, field string) error {
	if value == "" {
		return errors.New(field + "不能为空")
	}
	if len([]rune(value)) > maxChartLabelLength {
		return fmt.Errorf("%s不能超过 %d 个字符", field, maxChartLabelLength)
	}
	return nil
}

func isFiniteChartNumber(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func decodeStrictChartJSON(raw json.RawMessage, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("消息体包含多余内容")
	}
	return nil
}
