package mail

import (
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
	"html/template"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	mailstd "net/mail"
	"net/smtp"
	"net/textproto"
	"strconv"
	"strings"
	"time"

	"app/internal/application/emailauth"
	settingsapp "app/internal/application/settings"
)

const (
	smtpTimeout = 10 * time.Second
	themeColor  = "#14b8a6"
)

type SMTPMailer struct{}

func NewSMTPMailer() *SMTPMailer {
	return &SMTPMailer{}
}

func (m *SMTPMailer) SendLoginCode(ctx context.Context, message emailauth.Mail) error {
	content, err := renderLoginCodeMessage(message)
	if err != nil {
		return err
	}
	return sendSMTP(ctx, message, content)
}

func (m *SMTPMailer) SendTestEmail(ctx context.Context, message emailauth.Mail) error {
	content, err := renderTestEmailMessage(message)
	if err != nil {
		return err
	}
	return sendSMTP(ctx, message, content)
}

func sendSMTP(ctx context.Context, message emailauth.Mail, content []byte) error {
	host := strings.TrimSpace(message.SMTP.SMTPHost)
	address := net.JoinHostPort(host, strconv.Itoa(message.SMTP.SMTPPort))
	dialer := &net.Dialer{Timeout: smtpTimeout}
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12, ServerName: host}

	var conn net.Conn
	var err error
	if message.SMTP.SMTPSecurity == settingsapp.SMTPSecurityTLS {
		conn, err = tls.DialWithDialer(dialer, "tcp", address, tlsConfig)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", address)
	}
	if err != nil {
		return fmt.Errorf("connect to SMTP server: %w", err)
	}
	defer conn.Close()

	deadline := time.Now().Add(smtpTimeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	if err := conn.SetDeadline(deadline); err != nil {
		return fmt.Errorf("set SMTP deadline: %w", err)
	}
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return fmt.Errorf("open SMTP client: %w", err)
	}
	defer client.Close()

	if message.SMTP.SMTPSecurity == settingsapp.SMTPSecuritySTARTTLS {
		if err := client.StartTLS(tlsConfig); err != nil {
			return fmt.Errorf("start SMTP TLS: %w", err)
		}
	}
	if message.SMTP.SMTPUsername != "" {
		auth, err := selectSMTPAuth(client, message.SMTP, host)
		if err != nil {
			return err
		}
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("authenticate SMTP client: %w", err)
		}
	}
	if err := client.Mail(message.SMTP.FromEmail); err != nil {
		return fmt.Errorf("set SMTP sender: %w", err)
	}
	if err := client.Rcpt(message.Recipient); err != nil {
		return fmt.Errorf("set SMTP recipient: %w", err)
	}
	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("open SMTP message: %w", err)
	}
	if _, err := writer.Write(content); err != nil {
		_ = writer.Close()
		return fmt.Errorf("write SMTP message: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("close SMTP message: %w", err)
	}
	// A successful DATA close means the server accepted the message. A later
	// QUIT failure must not make the delivered verification code unusable.
	_ = client.Quit()
	return nil
}

func renderLoginCodeMessage(message emailauth.Mail) ([]byte, error) {
	data := loginCodeTemplateData{
		AppName:          message.AppName,
		OrganizationName: message.OrganizationName,
		Code:             message.Code,
		ExpiresInMinutes: int(message.ExpiresIn.Minutes()),
		ClientLoginURL:   message.ClientLoginURL,
		LogoURL:          message.LogoURL,
		ThemeColor:       themeColor,
	}
	var htmlBody bytes.Buffer
	if err := loginCodeHTMLTemplate.Execute(&htmlBody, data); err != nil {
		return nil, fmt.Errorf("render login-code HTML: %w", err)
	}
	plainBody := fmt.Sprintf(
		"%s 登录验证码\n\n你的登录验证码是：%s\n\n验证码将在 %d 分钟后失效，请勿向他人透露。\n\n访问地址：%s\n\n如果不是你本人操作，请忽略此邮件。\n\n%s\n",
		message.AppName, message.Code, data.ExpiresInMinutes, message.ClientLoginURL, message.OrganizationName,
	)
	return renderAlternativeMessage(message, "【"+message.AppName+"】登录验证码", plainBody, htmlBody.String())
}

func renderTestEmailMessage(message emailauth.Mail) ([]byte, error) {
	data := loginCodeTemplateData{
		AppName: message.AppName, OrganizationName: message.OrganizationName,
		ClientLoginURL: message.ClientLoginURL, LogoURL: message.LogoURL, ThemeColor: themeColor,
	}
	var htmlBody bytes.Buffer
	if err := testEmailHTMLTemplate.Execute(&htmlBody, data); err != nil {
		return nil, fmt.Errorf("render SMTP test HTML: %w", err)
	}
	plainBody := fmt.Sprintf(
		"%s SMTP 配置测试\n\n测试邮件发送成功，你的 SMTP 配置可以正常使用。\n\n访问地址：%s\n\n%s\n",
		message.AppName, message.ClientLoginURL, message.OrganizationName,
	)
	return renderAlternativeMessage(message, "【"+message.AppName+"】SMTP 配置测试", plainBody, htmlBody.String())
}

func renderAlternativeMessage(message emailauth.Mail, subjectText string, plainBody string, htmlBody string) ([]byte, error) {

	var body bytes.Buffer
	multipartWriter := multipart.NewWriter(&body)
	if err := writeAlternativePart(multipartWriter, "text/plain; charset=UTF-8", plainBody); err != nil {
		return nil, err
	}
	if err := writeAlternativePart(multipartWriter, "text/html; charset=UTF-8", htmlBody); err != nil {
		return nil, err
	}
	if err := multipartWriter.Close(); err != nil {
		return nil, fmt.Errorf("finish login-code MIME body: %w", err)
	}

	fromName := strings.TrimSpace(message.SMTP.FromName)
	if fromName == "" {
		fromName = message.AppName
	}
	fromName = safeHeaderText(fromName)
	from := (&mailstd.Address{Name: fromName, Address: message.SMTP.FromEmail}).String()
	to := (&mailstd.Address{Address: message.Recipient}).String()
	subject := mime.QEncoding.Encode("UTF-8", safeHeaderText(subjectText))
	var result bytes.Buffer
	fmt.Fprintf(&result, "From: %s\r\n", from)
	fmt.Fprintf(&result, "To: %s\r\n", to)
	fmt.Fprintf(&result, "Subject: %s\r\n", subject)
	fmt.Fprintf(&result, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	fmt.Fprint(&result, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&result, "Content-Type: multipart/alternative; boundary=%q\r\n", multipartWriter.Boundary())
	fmt.Fprint(&result, "\r\n")
	result.Write(body.Bytes())
	return result.Bytes(), nil
}

func selectSMTPAuth(client *smtp.Client, settings settingsapp.EmailLoginSettings, host string) (smtp.Auth, error) {
	available, mechanisms := client.Extension("AUTH")
	if !available {
		return nil, fmt.Errorf("SMTP server does not support authentication")
	}
	return newSMTPAuth(mechanisms, settings, host)
}

func newSMTPAuth(mechanisms string, settings settingsapp.EmailLoginSettings, host string) (smtp.Auth, error) {
	supported := make(map[string]bool)
	for _, mechanism := range strings.Fields(strings.ToUpper(mechanisms)) {
		supported[mechanism] = true
	}
	if supported["PLAIN"] {
		return smtp.PlainAuth("", settings.SMTPUsername, settings.SMTPPassword, host), nil
	}
	if supported["LOGIN"] {
		return &loginAuth{username: settings.SMTPUsername, password: settings.SMTPPassword, host: host}, nil
	}
	return nil, fmt.Errorf("SMTP server authentication mechanisms are unsupported: %s", mechanisms)
}

type loginAuth struct {
	username string
	password string
	host     string
	step     int
}

func (a *loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS && !isLocalSMTPHost(server.Name) {
		return "", nil, fmt.Errorf("unencrypted SMTP connection")
	}
	if server.Name != a.host {
		return "", nil, fmt.Errorf("wrong SMTP host name")
	}
	a.step = 0
	return "LOGIN", nil, nil
}

func (a *loginAuth) Next(_ []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	switch a.step {
	case 0:
		a.step++
		return []byte(a.username), nil
	case 1:
		a.step++
		return []byte(a.password), nil
	default:
		return nil, fmt.Errorf("unexpected SMTP LOGIN challenge")
	}
}

func isLocalSMTPHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func writeAlternativePart(writer *multipart.Writer, contentType string, body string) error {
	header := make(textproto.MIMEHeader)
	header.Set("Content-Type", contentType)
	header.Set("Content-Transfer-Encoding", "quoted-printable")
	part, err := writer.CreatePart(header)
	if err != nil {
		return fmt.Errorf("create login-code MIME part: %w", err)
	}
	encoded := quotedprintable.NewWriter(part)
	if _, err := encoded.Write([]byte(body)); err != nil {
		_ = encoded.Close()
		return fmt.Errorf("write login-code MIME part: %w", err)
	}
	if err := encoded.Close(); err != nil {
		return fmt.Errorf("finish login-code MIME part: %w", err)
	}
	return nil
}

func safeHeaderText(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

type loginCodeTemplateData struct {
	AppName          string
	OrganizationName string
	Code             string
	ExpiresInMinutes int
	ClientLoginURL   string
	LogoURL          string
	ThemeColor       string
}

var loginCodeHTMLTemplate = template.Must(template.New("login-code").Parse(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{.AppName}} 登录验证码</title>
</head>
<body style="margin:0;padding:0;background:#f4f7f7;color:#17201f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f7f7;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e2e8e7;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(15,118,110,0.08);">
          <tr>
            <td style="padding:24px 32px;background:{{.ThemeColor}};">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding-right:12px;vertical-align:middle;">
                    <img src="{{.LogoURL}}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border-radius:10px;background:#ffffff;object-fit:cover;">
                  </td>
                  <td style="vertical-align:middle;color:#ffffff;font-size:20px;font-weight:700;line-height:1.3;">{{.AppName}}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 32px;">
              <div style="font-size:22px;font-weight:700;line-height:1.4;color:#17201f;">登录验证码</div>
              <div style="margin-top:10px;font-size:14px;line-height:1.8;color:#667572;">请在登录页面输入下面的验证码：</div>
              <div style="margin:24px 0;padding:20px 12px;border:1px solid #b9ebe5;border-radius:12px;background:#effcf9;text-align:center;color:#0f766e;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:34px;font-weight:700;letter-spacing:8px;line-height:1.2;">{{.Code}}</div>
              <div style="font-size:14px;line-height:1.8;color:#667572;">验证码将在 <strong style="color:#17201f;">{{.ExpiresInMinutes}} 分钟</strong>后失效，请勿向他人透露。</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:28px;">
                <tr>
                  <td align="center">
                    <a href="{{.ClientLoginURL}}" style="display:inline-block;padding:12px 24px;border-radius:10px;background:{{.ThemeColor}};color:#ffffff;font-size:15px;font-weight:700;line-height:1.4;text-decoration:none;">打开{{.AppName}}登录页面</a>
                  </td>
                </tr>
              </table>
              <div style="margin-top:22px;padding-top:20px;border-top:1px solid #edf1f0;font-size:12px;line-height:1.7;color:#82908d;word-break:break-all;">如果按钮无法打开，请复制以下地址到浏览器：<br><a href="{{.ClientLoginURL}}" style="color:#0f766e;text-decoration:none;">{{.ClientLoginURL}}</a></div>
              <div style="margin-top:16px;font-size:12px;line-height:1.7;color:#82908d;">如果不是你本人操作，请忽略此邮件。</div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:18px 24px;background:#f8faf9;border-top:1px solid #edf1f0;color:#82908d;font-size:12px;line-height:1.6;">{{.OrganizationName}} · {{.AppName}}智能协作平台</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`))

var testEmailHTMLTemplate = template.Must(template.New("smtp-test").Parse(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>{{.AppName}} SMTP 配置测试</title></head>
<body style="margin:0;padding:0;background:#f4f7f7;color:#17201f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f7f7;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e2e8e7;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:24px 32px;background:{{.ThemeColor}};color:#ffffff;font-size:20px;font-weight:700;"><img src="{{.LogoURL}}" width="40" height="40" alt="" style="display:inline-block;width:40px;height:40px;margin-right:12px;border-radius:10px;background:#ffffff;vertical-align:middle;">{{.AppName}}</td></tr>
        <tr><td style="padding:36px 32px;">
          <div style="font-size:22px;font-weight:700;line-height:1.4;">SMTP 配置成功</div>
          <div style="margin-top:12px;font-size:14px;line-height:1.8;color:#667572;">测试邮件已成功送达，当前 SMTP 配置可以正常使用。</div>
          <div style="margin-top:28px;"><a href="{{.ClientLoginURL}}" style="display:inline-block;padding:12px 24px;border-radius:10px;background:{{.ThemeColor}};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">打开{{.AppName}}</a></div>
        </td></tr>
        <tr><td align="center" style="padding:18px 24px;background:#f8faf9;border-top:1px solid #edf1f0;color:#82908d;font-size:12px;">{{.OrganizationName}} · {{.AppName}}智能协作平台</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`))

var _ emailauth.Mailer = (*SMTPMailer)(nil)
