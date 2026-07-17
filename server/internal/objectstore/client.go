package objectstore

import (
	"context"
	"fmt"
	"strings"

	appconfig "app/internal/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Client struct {
	cfg              appconfig.StorageConfig
	temporaryPresign *s3.PresignClient
	s3               *s3.Client
}

func New(ctx context.Context, cfg appconfig.StorageConfig) (*Client, error) {
	if cfg.Provider != "s3" {
		return nil, fmt.Errorf("unsupported storage provider %q", cfg.Provider)
	}

	awsCfg, err := awsconfig.LoadDefaultConfig(
		ctx,
		awsconfig.WithRegion(cfg.Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.AccessKeyID,
			cfg.SecretAccessKey,
			"",
		)),
	)
	if err != nil {
		return nil, fmt.Errorf("load s3 config: %w", err)
	}
	if strings.TrimSpace(cfg.Endpoint) != "" {
		awsCfg.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
		awsCfg.ResponseChecksumValidation = aws.ResponseChecksumValidationWhenRequired
	}

	client := s3.NewFromConfig(awsCfg, func(options *s3.Options) {
		if strings.TrimSpace(cfg.Endpoint) != "" {
			options.BaseEndpoint = aws.String(cfg.Endpoint)
		}
		options.UsePathStyle = cfg.ForcePathStyle
	})
	temporaryPresignClient := newBucketPresignClient(
		awsCfg,
		cfg,
		cfg.Buckets.Temporary,
		cfg.AssetHostnames.Temporary,
	)

	return &Client{
		cfg:              cfg,
		temporaryPresign: temporaryPresignClient,
		s3:               client,
	}, nil
}

func newBucketPresignClient(
	awsCfg aws.Config,
	cfg appconfig.StorageConfig,
	bucket string,
	hostname string,
) *s3.PresignClient {
	baseEndpoint := strings.TrimSpace(cfg.Endpoint)
	hostname = strings.TrimSpace(hostname)
	bucket = strings.TrimSpace(bucket)

	if cfg.ForcePathStyle {
		baseEndpoint = "https://" + hostname
	} else if suffix, ok := strings.CutPrefix(hostname, bucket+"."); ok {
		// Virtual-host-style S3 clients add the bucket to the endpoint host. COS
		// exposes bucket-specific hosts, so derive their shared regional endpoint
		// before asking the SDK to sign the request.
		baseEndpoint = "https://" + suffix
	}

	client := s3.NewFromConfig(awsCfg, func(options *s3.Options) {
		if baseEndpoint != "" {
			options.BaseEndpoint = aws.String(baseEndpoint)
		}
		options.UsePathStyle = cfg.ForcePathStyle
	})
	return s3.NewPresignClient(client)
}
