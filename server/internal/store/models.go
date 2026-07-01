package store

import "time"

const (
	UserStatusActive   = "active"
	UserStatusDisabled = "disabled"
)

type User struct {
	ID           string    `gorm:"type:uuid;primaryKey"`
	Email        string    `gorm:"size:320;not null;uniqueIndex"`
	Name         string    `gorm:"size:120;not null"`
	PasswordHash string    `gorm:"not null"`
	Status       string    `gorm:"size:32;not null;index"`
	CreatedAt    time.Time `gorm:"not null"`
	UpdatedAt    time.Time `gorm:"not null"`
}

type AdminSession struct {
	ID         string    `gorm:"type:uuid;primaryKey"`
	TokenHash  string    `gorm:"size:64;not null;uniqueIndex"`
	ExpiresAt  time.Time `gorm:"not null;index"`
	CreatedAt  time.Time `gorm:"not null"`
	LastSeenAt time.Time `gorm:"not null"`
	UserAgent  string    `gorm:"size:512"`
	IP         string    `gorm:"size:64"`
}

type UserSession struct {
	ID         string    `gorm:"type:uuid;primaryKey"`
	TokenHash  string    `gorm:"size:64;not null;uniqueIndex"`
	UserID     string    `gorm:"type:uuid;not null;index"`
	User       User      `gorm:"constraint:OnDelete:CASCADE;"`
	ExpiresAt  time.Time `gorm:"not null;index"`
	CreatedAt  time.Time `gorm:"not null"`
	LastSeenAt time.Time `gorm:"not null"`
	UserAgent  string    `gorm:"size:512"`
	IP         string    `gorm:"size:64"`
}
