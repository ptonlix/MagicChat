package auth

import (
	"crypto/rand"
	"fmt"
	"math/big"
)

const passwordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

func GenerateInitialPassword(length int) (string, error) {
	if length <= 0 {
		return "", fmt.Errorf("password length must be positive")
	}

	password := make([]byte, length)
	max := big.NewInt(int64(len(passwordAlphabet)))
	for i := range password {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", fmt.Errorf("generate random password: %w", err)
		}
		password[i] = passwordAlphabet[n.Int64()]
	}

	return string(password), nil
}
