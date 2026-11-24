package main

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// ---- データモデル ----

type Contest struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Theme       string    `json:"theme"`       // お題
	Description string    `json:"description"` // 募集要項など
	SubmitStart time.Time `json:"submitStart"` // 投稿受付開始
	SubmitEnd   time.Time `json:"submitEnd"`   // 投稿締切
	VoteEnd     time.Time `json:"voteEnd"`     // 投票締切＝結果発表（作者公開）
	CreatedAt   time.Time `json:"createdAt"`
}

type Entry struct {
	ID            string    `json:"id"`
	ContestID     string    `json:"contestId"`
	No            int       `json:"no"` // コンペ内の作品番号
	Title         string    `json:"title"`
	Summary       string    `json:"summary"`
	Body          string    `json:"body"`
	Afterword     string    `json:"afterword"`
	PenName       string    `json:"penName"`
	Tags          []string  `json:"tags"`
	AllowComments bool      `json:"allowComments"`
	PassHash      string    `json:"passHash"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type Vote struct {
	ID        string    `json:"id"`
	EntryID   string    `json:"entryId"`
	Name      string    `json:"name"`     // 投票者のハンドルネーム
	Comment   string    `json:"comment"`  // 一言感想（必須）
	VoterKey  string    `json:"voterKey"` // ブラウザ固有キーのハッシュ
	IPHash    string    `json:"ipHash"`
	Points    int       `json:"points"`
	CreatedAt time.Time `json:"createdAt"`
}

type Comment struct {
	ID        string    `json:"id"`
	EntryID   string    `json:"entryId"`
	Name      string    `json:"name"`
	Body      string    `json:"body"`
	PassHash  string    `json:"passHash"`
	CreatedAt time.Time `json:"createdAt"`
}

type DB struct {
	Contests []*Contest `json:"contests"`
	Entries  []*Entry   `json:"entries"`
	Votes    []*Vote    `json:"votes"`
	Comments []*Comment `json:"comments"`
}

// ---- 保存（JSONファイル、書き込みは一時ファイル→rename で原子的に） ----

type Store struct {
	mu   sync.RWMutex
	path string
	db   DB
}

func OpenStore(path string) (*Store, error) {
	s := &Store{path: path}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &s.db); err != nil {
		return nil, err
	}
	for _, v := range s.db.Votes { // 旧データ互換：IDのない票に付番
		if v.ID == "" {
			v.ID = newID()
		}
	}
	return s, nil
}

// save は mu をロックした状態で呼ぶこと
func (s *Store) save() error {
	b, err := json.MarshalIndent(&s.db, "", " ")
	if err != nil {
		return err
	}
	if dir := filepath.Dir(s.path); dir != "" {
		os.MkdirAll(dir, 0o755)
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// ---- ユーティリティ ----

func newID() string {
	b := make([]byte, 12)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func hashPassword(pw string) string {
	salt := make([]byte, 16)
	rand.Read(salt)
	k, _ := pbkdf2.Key(sha256.New, pw, salt, 120000, 32)
	return hex.EncodeToString(salt) + ":" + hex.EncodeToString(k)
}

func checkPassword(stored, pw string) bool {
	if len(stored) < 34 || pw == "" {
		return false
	}
	salt, err1 := hex.DecodeString(stored[:32])
	want, err2 := hex.DecodeString(stored[33:])
	if err1 != nil || err2 != nil {
		return false
	}
	k, _ := pbkdf2.Key(sha256.New, pw, salt, 120000, 32)
	return subtle.ConstantTimeCompare(k, want) == 1
}

func hashKey(secret, v string) string {
	h := sha256.Sum256([]byte(secret + "|" + v))
	return hex.EncodeToString(h[:])
}

// ---- フェーズ判定 ----

const (
	PhaseUpcoming   = "upcoming"   // 受付前
	PhaseSubmission = "submission" // 投稿期間（閲覧・投票可、作者は匿名）
	PhaseVoting     = "voting"     // 投票期間（投稿締切後、作者は匿名）
	PhaseClosed     = "closed"     // 結果発表（作者公開・順位公開）
)

func (c *Contest) Phase(now time.Time) string {
	switch {
	case now.Before(c.SubmitStart):
		return PhaseUpcoming
	case now.Before(c.SubmitEnd):
		return PhaseSubmission
	case now.Before(c.VoteEnd):
		return PhaseVoting
	default:
		return PhaseClosed
	}
}
