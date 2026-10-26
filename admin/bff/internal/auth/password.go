package auth

import "golang.org/x/crypto/bcrypt"

// HashPassword 使用 bcrypt cost=10。
func HashPassword(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), 10)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// CheckPassword 常量时间比对。
func CheckPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}
