package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// 滑动窗口限流（单实例内存级，适用于当前单机部署）
// 无外部依赖；多实例需改为 Redis 版

type ipWindow struct {
	timestamps []int64
	mu         sync.Mutex
}

var ipLimiter sync.Map // ip(string) -> *ipWindow

// RateLimit 按 IP 限流：max 次每 window。超限返回 429。
func RateLimit(max int, window time.Duration) gin.HandlerFunc {
	now := func() int64 { return time.Now().UnixNano() }
	cutoff := int64(window)

	return func(c *gin.Context) {
		ip := c.ClientIP()

		val, _ := ipLimiter.LoadOrStore(ip, &ipWindow{})
		w := val.(*ipWindow)

		w.mu.Lock()
		cur := now()
		// 清理过期
		start := 0
		for i := len(w.timestamps) - 1; i >= 0; i-- {
			if cur-w.timestamps[i] < cutoff {
				break
			}
			start = i + 1
		}
		if start > 0 {
			w.timestamps = w.timestamps[start:]
		}

		if len(w.timestamps) >= max {
			w.mu.Unlock()
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":   "rate_limited",
				"message": "尝试过于频繁，请稍后再试",
			})
			return
		}

		w.timestamps = append(w.timestamps, cur)
		w.mu.Unlock()
		c.Next()
	}
}
