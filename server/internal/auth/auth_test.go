package auth

import "testing"

func TestHashPasswordAndVerifyPassword(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	if hash == "" {
		t.Fatal("HashPassword() returned empty hash")
	}
	if hash == "correct horse battery staple" {
		t.Fatal("HashPassword() returned plaintext")
	}

	ok, err := VerifyPassword("correct horse battery staple", hash)
	if err != nil {
		t.Fatalf("VerifyPassword() error = %v", err)
	}
	if !ok {
		t.Fatal("VerifyPassword() = false, want true")
	}
}

func TestVerifyPasswordRejectsWrongPassword(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}

	ok, err := VerifyPassword("wrong password", hash)
	if err != nil {
		t.Fatalf("VerifyPassword() error = %v", err)
	}
	if ok {
		t.Fatal("VerifyPassword() = true, want false")
	}
}

func TestGenerateInitialPassword(t *testing.T) {
	password, err := GenerateInitialPassword(16)
	if err != nil {
		t.Fatalf("GenerateInitialPassword() error = %v", err)
	}
	if len(password) != 16 {
		t.Fatalf("GenerateInitialPassword() length = %d, want 16", len(password))
	}

	other, err := GenerateInitialPassword(16)
	if err != nil {
		t.Fatalf("GenerateInitialPassword() error = %v", err)
	}
	if password == other {
		t.Fatal("GenerateInitialPassword() returned same value twice")
	}
}

func TestSessionTokenHashing(t *testing.T) {
	token, err := GenerateSessionToken()
	if err != nil {
		t.Fatalf("GenerateSessionToken() error = %v", err)
	}
	if token == "" {
		t.Fatal("GenerateSessionToken() returned empty token")
	}

	hash := HashSessionToken(token)
	if hash == "" {
		t.Fatal("HashSessionToken() returned empty hash")
	}
	if hash == token {
		t.Fatal("HashSessionToken() returned plaintext token")
	}
	if hash != HashSessionToken(token) {
		t.Fatal("HashSessionToken() is not deterministic")
	}
}
