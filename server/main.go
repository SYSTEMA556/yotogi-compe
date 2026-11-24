package main

import (
	"crypto/subtle"
	"embed"
	"encoding/json"
	"flag"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

//go:embed all:dist
var distFS embed.FS

type App struct {
	st         *Store
	adminToken string
	secret     string // 投票キー等のハッシュ用
	strictIP   bool
	now        func() time.Time
}

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	dataPath := flag.String("data", "data/compe.json", "data file path")
	demo := flag.Bool("demo", false, "データが空ならデモ用コンペを作成")
	flag.Parse()

	st, err := OpenStore(*dataPath)
	if err != nil {
		log.Fatal(err)
	}
	app := &App{
		st:         st,
		adminToken: os.Getenv("ADMIN_TOKEN"),
		secret:     os.Getenv("HASH_SECRET"),
		strictIP:   os.Getenv("STRICT_IP") == "1",
		now:        time.Now,
	}
	if app.adminToken == "" {
		app.adminToken = newID()
		log.Printf("ADMIN_TOKEN 未設定のため一時トークンを発行: %s", app.adminToken)
	}
	if app.secret == "" {
		app.secret = "change-me"
		log.Printf("警告: HASH_SECRET を設定してください")
	}
	if *demo {
		app.seedDemo()
	}

	mux := http.NewServeMux()
	app.routes(mux)

	sub, _ := fs.Sub(distFS, "dist")
	mux.Handle("/", http.FileServer(http.FS(sub)))

	log.Printf("listening on %s", *addr)
	log.Fatal(http.ListenAndServe(*addr, securityHeaders(mux)))
}

func securityHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		h.ServeHTTP(w, r)
	})
}

func (a *App) routes(m *http.ServeMux) {
	m.HandleFunc("GET /api/contests", a.listContests)
	m.HandleFunc("GET /api/contests/{id}", a.getContest)
	m.HandleFunc("POST /api/contests/{id}/entries", a.createEntry)
	m.HandleFunc("GET /api/entries/{id}", a.getEntry)
	m.HandleFunc("POST /api/entries/{id}/auth", a.authEntry)
	m.HandleFunc("PUT /api/entries/{id}", a.updateEntry)
	m.HandleFunc("DELETE /api/entries/{id}", a.deleteEntry)
	m.HandleFunc("POST /api/entries/{id}/vote", a.vote)
	m.HandleFunc("POST /api/entries/{id}/comments", a.createComment)
	m.HandleFunc("DELETE /api/comments/{id}", a.deleteComment)
	m.HandleFunc("GET /api/tags", a.tags)
	// 管理者
	m.HandleFunc("POST /api/admin/check", a.admin(func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]bool{"ok": true}) }))
	m.HandleFunc("POST /api/admin/contests", a.admin(a.createContest))
	m.HandleFunc("PUT /api/admin/contests/{id}", a.admin(a.updateContest))
	m.HandleFunc("DELETE /api/admin/contests/{id}", a.admin(a.deleteContest))
	m.HandleFunc("GET /api/admin/contests/{id}/votes", a.admin(a.reviewVotes))
	m.HandleFunc("DELETE /api/admin/votes/{id}", a.admin(a.deleteVote))
}

// ---- 共通 ----

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		fail(w, 400, "リクエストの形式が不正です")
		return false
	}
	return true
}

func (a *App) isAdmin(r *http.Request) bool {
	t := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	return t != "" && subtle.ConstantTimeCompare([]byte(t), []byte(a.adminToken)) == 1
}

func (a *App) admin(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.isAdmin(r) {
			fail(w, 401, "管理者トークンが違います")
			return
		}
		h(w, r)
	}
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" && os.Getenv("TRUST_PROXY") == "1" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	return host
}

func runeLen(s string) int { return utf8.RuneCountInString(s) }

// ---- 表示用ビュー（匿名化はここで強制する） ----

type ScoreView struct {
	Total int     `json:"total"`
	Count int     `json:"count"`
	Avg   float64 `json:"avg"`
	Rank  int     `json:"rank"`
}

type EntryView struct {
	ID            string     `json:"id"`
	ContestID     string     `json:"contestId"`
	No            int        `json:"no"`
	Title         string     `json:"title"`
	Summary       string     `json:"summary"`
	Body          string     `json:"body,omitempty"`
	Afterword     string     `json:"afterword,omitempty"`
	PenName       string     `json:"penName"`
	Anonymous     bool       `json:"anonymous"`
	Tags          []string   `json:"tags"`
	AllowComments bool       `json:"allowComments"`
	CommentCount  int        `json:"commentCount"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	Score         *ScoreView `json:"score,omitempty"`
}

type ContestView struct {
	*Contest
	Phase      string    `json:"phase"`
	EntryCount int       `json:"entryCount"`
	ServerTime time.Time `json:"serverTime"`
}

// 以下は st.mu を読みロックした状態で呼ぶ

func (a *App) contestByID(id string) *Contest {
	for _, c := range a.st.db.Contests {
		if c.ID == id {
			return c
		}
	}
	return nil
}

func (a *App) entryByID(id string) *Entry {
	for _, e := range a.st.db.Entries {
		if e.ID == id {
			return e
		}
	}
	return nil
}

func (a *App) entriesOf(cid string) []*Entry {
	var out []*Entry
	for _, e := range a.st.db.Entries {
		if e.ContestID == cid {
			out = append(out, e)
		}
	}
	return out
}

func (a *App) contestView(c *Contest) ContestView {
	return ContestView{Contest: c, Phase: c.Phase(a.now()), EntryCount: len(a.entriesOf(c.ID)), ServerTime: a.now()}
}

// scores はコンペ内の全作品の得点と順位を計算する
func (a *App) scores(cid string) map[string]*ScoreView {
	m := map[string]*ScoreView{}
	ents := a.entriesOf(cid)
	for _, e := range ents {
		m[e.ID] = &ScoreView{}
	}
	for _, v := range a.st.db.Votes {
		if s, ok := m[v.EntryID]; ok {
			s.Total += v.Points
			s.Count++
		}
	}
	list := make([]*ScoreView, 0, len(m))
	for _, s := range m {
		if s.Count > 0 {
			s.Avg = float64(s.Total) / float64(s.Count)
		}
		list = append(list, s)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Total != list[j].Total {
			return list[i].Total > list[j].Total
		}
		return list[i].Count > list[j].Count
	})
	for i, s := range list {
		if i > 0 && s.Total == list[i-1].Total && s.Count == list[i-1].Count {
			s.Rank = list[i-1].Rank // 同点は同順位
		} else {
			s.Rank = i + 1
		}
	}
	return m
}

func (a *App) commentCount(eid string) int {
	n := 0
	for _, c := range a.st.db.Comments {
		if c.EntryID == eid {
			n++
		}
	}
	return n
}

func (a *App) entryView(e *Entry, c *Contest, full bool, sc map[string]*ScoreView) EntryView {
	closed := c.Phase(a.now()) == PhaseClosed
	v := EntryView{
		ID: e.ID, ContestID: e.ContestID, No: e.No, Title: e.Title, Summary: e.Summary,
		Tags: e.Tags, AllowComments: e.AllowComments, CommentCount: a.commentCount(e.ID),
		CreatedAt: e.CreatedAt, UpdatedAt: e.UpdatedAt, Anonymous: !closed,
	}
	if v.Tags == nil {
		v.Tags = []string{}
	}
	if full {
		v.Body = e.Body
	}
	if closed {
		// 結果発表後のみ作者名・あとがき・得点を公開
		v.PenName = e.PenName
		if full {
			v.Afterword = e.Afterword
		}
		if sc != nil {
			v.Score = sc[e.ID]
		}
	}
	return v
}

// ---- コンペ ----

func (a *App) listContests(w http.ResponseWriter, r *http.Request) {
	a.st.mu.RLock()
	defer a.st.mu.RUnlock()
	out := []ContestView{}
	for _, c := range a.st.db.Contests {
		out = append(out, a.contestView(c))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].SubmitStart.After(out[j].SubmitStart) })
	writeJSON(w, 200, out)
}

func (a *App) getContest(w http.ResponseWriter, r *http.Request) {
	a.st.mu.RLock()
	defer a.st.mu.RUnlock()
	c := a.contestByID(r.PathValue("id"))
	if c == nil {
		fail(w, 404, "コンペが見つかりません")
		return
	}
	cv := a.contestView(c)
	entries := []EntryView{}
	if cv.Phase != PhaseUpcoming {
		var sc map[string]*ScoreView
		if cv.Phase == PhaseClosed {
			sc = a.scores(c.ID)
		}
		for _, e := range a.entriesOf(c.ID) {
			entries = append(entries, a.entryView(e, c, false, sc))
		}
		if cv.Phase == PhaseClosed {
			sort.SliceStable(entries, func(i, j int) bool { return entries[i].Score.Rank < entries[j].Score.Rank })
		} else {
			sort.Slice(entries, func(i, j int) bool { return entries[i].No < entries[j].No })
		}
	}
	writeJSON(w, 200, map[string]any{"contest": cv, "entries": entries})
}

type contestInput struct {
	Title       string    `json:"title"`
	Theme       string    `json:"theme"`
	Description string    `json:"description"`
	SubmitStart time.Time `json:"submitStart"`
	SubmitEnd   time.Time `json:"submitEnd"`
	VoteEnd     time.Time `json:"voteEnd"`
}

func (in *contestInput) validate() string {
	in.Title = strings.TrimSpace(in.Title)
	in.Theme = strings.TrimSpace(in.Theme)
	switch {
	case in.Title == "" || runeLen(in.Title) > 100:
		return "コンペ名は1〜100文字で入力してください"
	case in.Theme == "" || runeLen(in.Theme) > 100:
		return "お題は1〜100文字で入力してください"
	case runeLen(in.Description) > 10000:
		return "説明が長すぎます"
	case !in.SubmitStart.Before(in.SubmitEnd):
		return "投稿締切は受付開始より後にしてください"
	case in.VoteEnd.Before(in.SubmitEnd):
		return "投票締切は投稿締切以降にしてください"
	}
	return ""
}

func (a *App) createContest(w http.ResponseWriter, r *http.Request) {
	var in contestInput
	if !readJSON(w, r, &in) {
		return
	}
	if msg := in.validate(); msg != "" {
		fail(w, 400, msg)
		return
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	c := &Contest{ID: newID(), Title: in.Title, Theme: in.Theme, Description: in.Description,
		SubmitStart: in.SubmitStart, SubmitEnd: in.SubmitEnd, VoteEnd: in.VoteEnd, CreatedAt: a.now()}
	a.st.db.Contests = append(a.st.db.Contests, c)
	if err := a.st.save(); err != nil {
		fail(w, 500, "保存に失敗しました")
		return
	}
	writeJSON(w, 201, a.contestView(c))
}

func (a *App) updateContest(w http.ResponseWriter, r *http.Request) {
	var in contestInput
	if !readJSON(w, r, &in) {
		return
	}
	if msg := in.validate(); msg != "" {
		fail(w, 400, msg)
		return
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	c := a.contestByID(r.PathValue("id"))
	if c == nil {
		fail(w, 404, "コンペが見つかりません")
		return
	}
	c.Title, c.Theme, c.Description = in.Title, in.Theme, in.Description
	c.SubmitStart, c.SubmitEnd, c.VoteEnd = in.SubmitStart, in.SubmitEnd, in.VoteEnd
	if err := a.st.save(); err != nil {
		fail(w, 500, "保存に失敗しました")
		return
	}
	writeJSON(w, 200, a.contestView(c))
}

func (a *App) deleteContest(w http.ResponseWriter, r *http.Request) {
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	id := r.PathValue("id")
	if a.contestByID(id) == nil {
		fail(w, 404, "コンペが見つかりません")
		return
	}
	db := &a.st.db
	db.Contests = filter(db.Contests, func(c *Contest) bool { return c.ID != id })
	removed := map[string]bool{}
	db.Entries = filter(db.Entries, func(e *Entry) bool {
		if e.ContestID == id {
			removed[e.ID] = true
			return false
		}
		return true
	})
	db.Votes = filter(db.Votes, func(v *Vote) bool { return !removed[v.EntryID] })
	db.Comments = filter(db.Comments, func(c *Comment) bool { return !removed[c.EntryID] })
	a.st.save()
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func filter[T any](xs []T, keep func(T) bool) []T {
	out := xs[:0]
	for _, x := range xs {
		if keep(x) {
			out = append(out, x)
		}
	}
	return out
}

// ---- 作品 ----

type entryInput struct {
	Title         string   `json:"title"`
	Summary       string   `json:"summary"`
	Body          string   `json:"body"`
	Afterword     string   `json:"afterword"`
	PenName       string   `json:"penName"`
	Password      string   `json:"password"`
	NewPassword   string   `json:"newPassword"`
	Tags          []string `json:"tags"`
	AllowComments bool     `json:"allowComments"`
}

func (in *entryInput) validate(creating bool) string {
	in.Title = strings.TrimSpace(in.Title)
	in.PenName = strings.TrimSpace(in.PenName)
	seen := map[string]bool{}
	tags := []string{}
	for _, t := range in.Tags {
		t = strings.TrimSpace(t)
		if t != "" && !seen[t] && runeLen(t) <= 30 {
			seen[t] = true
			tags = append(tags, t)
		}
	}
	in.Tags = tags
	switch {
	case in.Title == "" || runeLen(in.Title) > 100:
		return "タイトルは1〜100文字で入力してください"
	case runeLen(in.Summary) > 500:
		return "作品概要は500文字以内にしてください"
	case strings.TrimSpace(in.Body) == "":
		return "本文を入力してください"
	case runeLen(in.Body) > 400000:
		return "本文が長すぎます（40万字まで）"
	case runeLen(in.Afterword) > 10000:
		return "あとがきが長すぎます"
	case in.PenName == "" || runeLen(in.PenName) > 50:
		return "ペンネームは1〜50文字で入力してください"
	case creating && runeLen(in.Password) < 4:
		return "編集用パスワードは4文字以上にしてください"
	case in.NewPassword != "" && runeLen(in.NewPassword) < 4:
		return "新しいパスワードは4文字以上にしてください"
	case len(in.Tags) > 10:
		return "タグは10個までです"
	}
	return ""
}

func (a *App) createEntry(w http.ResponseWriter, r *http.Request) {
	var in entryInput
	if !readJSON(w, r, &in) {
		return
	}
	if msg := in.validate(true); msg != "" {
		fail(w, 400, msg)
		return
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	c := a.contestByID(r.PathValue("id"))
	if c == nil {
		fail(w, 404, "コンペが見つかりません")
		return
	}
	if c.Phase(a.now()) != PhaseSubmission {
		fail(w, 403, "投稿期間外です")
		return
	}
	no := 0
	for _, e := range a.entriesOf(c.ID) {
		if e.No > no {
			no = e.No
		}
	}
	now := a.now()
	e := &Entry{ID: newID(), ContestID: c.ID, No: no + 1, Title: in.Title, Summary: in.Summary,
		Body: in.Body, Afterword: in.Afterword, PenName: in.PenName, Tags: in.Tags,
		AllowComments: in.AllowComments, PassHash: hashPassword(in.Password), CreatedAt: now, UpdatedAt: now}
	a.st.db.Entries = append(a.st.db.Entries, e)
	if err := a.st.save(); err != nil {
		fail(w, 500, "保存に失敗しました")
		return
	}
	writeJSON(w, 201, map[string]any{"id": e.ID, "no": e.No})
}

func (a *App) getEntry(w http.ResponseWriter, r *http.Request) {
	a.st.mu.RLock()
	defer a.st.mu.RUnlock()
	e := a.entryByID(r.PathValue("id"))
	if e == nil {
		fail(w, 404, "作品が見つかりません")
		return
	}
	c := a.contestByID(e.ContestID)
	cv := a.contestView(c)
	var sc map[string]*ScoreView
	if cv.Phase == PhaseClosed {
		sc = a.scores(c.ID)
	}
	comments := []map[string]any{}
	for _, cm := range a.st.db.Comments {
		if cm.EntryID == e.ID {
			comments = append(comments, map[string]any{"id": cm.ID, "name": cm.Name, "body": cm.Body, "createdAt": cm.CreatedAt})
		}
	}
	var myVote *PublicVote
	if key := r.Header.Get("X-Voter-Key"); key != "" {
		hk := hashKey(a.secret, key)
		for _, v := range a.st.db.Votes {
			if v.EntryID == e.ID && v.VoterKey == hk {
				pv := publicVote(v)
				myVote = &pv
			}
		}
	}
	// 投票の感想と点数は結果発表後に公開（途中で見えると点数が分かってしまうため）
	votes := []PublicVote{}
	if cv.Phase == PhaseClosed {
		for _, v := range a.st.db.Votes {
			if v.EntryID == e.ID {
				votes = append(votes, publicVote(v))
			}
		}
	}
	writeJSON(w, 200, map[string]any{
		"entry": a.entryView(e, c, true, sc), "contest": cv, "comments": comments,
		"myVote": myVote, "votes": votes, "maxPoints": MaxPoints,
	})
}

// authEntry: パスワード確認後、編集用に作品の全情報を返す
func (a *App) authEntry(w http.ResponseWriter, r *http.Request) {
	var in struct{ Password string }
	if !readJSON(w, r, &in) {
		return
	}
	a.st.mu.RLock()
	defer a.st.mu.RUnlock()
	e := a.entryByID(r.PathValue("id"))
	if e == nil {
		fail(w, 404, "作品が見つかりません")
		return
	}
	if !a.isAdmin(r) && !checkPassword(e.PassHash, in.Password) {
		fail(w, 403, "パスワードが違います")
		return
	}
	writeJSON(w, 200, map[string]any{
		"title": e.Title, "summary": e.Summary, "body": e.Body, "afterword": e.Afterword,
		"penName": e.PenName, "tags": e.Tags, "allowComments": e.AllowComments,
	})
}

func (a *App) updateEntry(w http.ResponseWriter, r *http.Request) {
	var in entryInput
	if !readJSON(w, r, &in) {
		return
	}
	if msg := in.validate(false); msg != "" {
		fail(w, 400, msg)
		return
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	e := a.entryByID(r.PathValue("id"))
	if e == nil {
		fail(w, 404, "作品が見つかりません")
		return
	}
	admin := a.isAdmin(r)
	if !admin && !checkPassword(e.PassHash, in.Password) {
		fail(w, 403, "パスワードが違います")
		return
	}
	if !admin && a.contestByID(e.ContestID).Phase(a.now()) != PhaseSubmission {
		fail(w, 403, "投稿期間が終わったため編集できません")
		return
	}
	e.Title, e.Summary, e.Body, e.Afterword = in.Title, in.Summary, in.Body, in.Afterword
	e.PenName, e.Tags, e.AllowComments = in.PenName, in.Tags, in.AllowComments
	if in.NewPassword != "" {
		e.PassHash = hashPassword(in.NewPassword)
	}
	e.UpdatedAt = a.now()
	if err := a.st.save(); err != nil {
		fail(w, 500, "保存に失敗しました")
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *App) deleteEntry(w http.ResponseWriter, r *http.Request) {
	var in struct{ Password string }
	if !readJSON(w, r, &in) {
		return
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	e := a.entryByID(r.PathValue("id"))
	if e == nil {
		fail(w, 404, "作品が見つかりません")
		return
	}
	admin := a.isAdmin(r)
	if !admin && !checkPassword(e.PassHash, in.Password) {
		fail(w, 403, "パスワードが違います")
		return
	}
	if !admin && a.contestByID(e.ContestID).Phase(a.now()) != PhaseSubmission {
		fail(w, 403, "投稿期間が終わったため削除できません")
		return
	}
	id := e.ID
	db := &a.st.db
	db.Entries = filter(db.Entries, func(x *Entry) bool { return x.ID != id })
	db.Votes = filter(db.Votes, func(v *Vote) bool { return v.EntryID != id })
	db.Comments = filter(db.Comments, func(c *Comment) bool { return c.EntryID != id })
	a.st.save()
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// ---- コメント ----

func (a *App) createComment(w http.ResponseWriter, r *http.Request) {
	var in struct{ Name, Body, Password string }
	if !readJSON(w, r, &in) {
		return
	}
	in.Name, in.Body = strings.TrimSpace(in.Name), strings.TrimSpace(in.Body)
	if in.Name == "" {
		in.Name = "名無し"
	}
	switch {
	case in.Body == "" || runeLen(in.Body) > 5000:
		fail(w, 400, "本文は1〜5000文字で入力してください")
		return
	case runeLen(in.Name) > 50:
		fail(w, 400, "ハンドルネームは50文字までです")
		return
	case runeLen(in.Password) < 4:
		fail(w, 400, "削除パスワードは4文字以上にしてください")
		return
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	e := a.entryByID(r.PathValue("id"))
	if e == nil {
		fail(w, 404, "作品が見つかりません")
		return
	}
	if !e.AllowComments {
		fail(w, 403, "この作品へのコメントは受け付けていません")
		return
	}
	cm := &Comment{ID: newID(), EntryID: e.ID, Name: in.Name, Body: in.Body, PassHash: hashPassword(in.Password), CreatedAt: a.now()}
	a.st.db.Comments = append(a.st.db.Comments, cm)
	a.st.save()
	writeJSON(w, 201, map[string]string{"id": cm.ID})
}

func (a *App) deleteComment(w http.ResponseWriter, r *http.Request) {
	var in struct{ Password string }
	if !readJSON(w, r, &in) {
		return
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	id := r.PathValue("id")
	var cm *Comment
	for _, c := range a.st.db.Comments {
		if c.ID == id {
			cm = c
		}
	}
	if cm == nil {
		fail(w, 404, "コメントが見つかりません")
		return
	}
	// 作品の編集パスワードでも削除可（作者による管理）
	e := a.entryByID(cm.EntryID)
	if !a.isAdmin(r) && !checkPassword(cm.PassHash, in.Password) && !(e != nil && checkPassword(e.PassHash, in.Password)) {
		fail(w, 403, "パスワードが違います")
		return
	}
	a.st.db.Comments = filter(a.st.db.Comments, func(c *Comment) bool { return c.ID != id })
	a.st.save()
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// ---- タグ候補 ----

func (a *App) tags(w http.ResponseWriter, r *http.Request) {
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	a.st.mu.RLock()
	defer a.st.mu.RUnlock()
	count := map[string]int{}
	for _, e := range a.st.db.Entries {
		for _, t := range e.Tags {
			if q == "" || strings.Contains(strings.ToLower(t), q) {
				count[t]++
			}
		}
	}
	out := make([]string, 0, len(count))
	for t := range count {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return count[out[i]] > count[out[j]] })
	if len(out) > 20 {
		out = out[:20]
	}
	writeJSON(w, 200, out)
}

// ---- デモデータ ----

func (a *App) seedDemo() {
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	if len(a.st.db.Contests) > 0 {
		return
	}
	now := a.now().Truncate(time.Minute)
	day := 24 * time.Hour
	mk := func(title, theme string, s, se, ve time.Duration) *Contest {
		c := &Contest{ID: newID(), Title: title, Theme: theme,
			Description: "お題に沿った作品を募集します。\n作者名は結果発表まで伏せられます。\n各作品に1〜10ポイントで投票してください。",
			SubmitStart: now.Add(s), SubmitEnd: now.Add(se), VoteEnd: now.Add(ve), CreatedAt: now}
		a.st.db.Contests = append(a.st.db.Contests, c)
		return c
	}
	open := mk("第1回 夜伽話コンペ", "紅い月", -3*day, 7*day, 14*day)
	done := mk("第0回 夜伽話コンペ", "雪", -30*day, -20*day, -10*day)
	demoComments := []string{"情景が目に浮かびました", "お題の使い方が上手い", "最後の一行が好きです", "もっと読みたかった"}
	add := func(c *Contest, no int, title, pen string, tags []string, pts ...int) {
		e := &Entry{ID: newID(), ContestID: c.ID, No: no, Title: title, Summary: "デモ用の作品です。",
			Body:      "　|紅魔館《こうまかん》の夜は長い。\n　《《月》》が昇るたび、彼女は窓辺に立つ。\n\n　――これはデモ用の本文ですわ。",
			Afterword: "読んでくださってありがとうございました。", PenName: pen, Tags: tags, AllowComments: true,
			PassHash: hashPassword("demo"), CreatedAt: c.SubmitStart.Add(time.Duration(no) * time.Hour), UpdatedAt: c.SubmitStart}
		e.UpdatedAt = e.CreatedAt
		a.st.db.Entries = append(a.st.db.Entries, e)
		for i, p := range pts {
			a.st.db.Votes = append(a.st.db.Votes, &Vote{ID: newID(), EntryID: e.ID, Name: "読者" + string(rune('A'+i)),
				Comment: demoComments[i%len(demoComments)], VoterKey: hashKey("demo", string(rune('a'+i))),
				Points: p, CreatedAt: c.SubmitEnd.Add(time.Duration(i+no) * 7 * time.Hour)})
		}
	}
	add(open, 1, "紅い月の下で", "作者A", []string{"レミリア・スカーレット", "シリアス"})
	add(open, 2, "月見団子と吸血鬼", "作者B", []string{"レミリア・スカーレット", "ほのぼの"})
	add(done, 1, "雪の日の門番", "寝物語を聞かせる程度の能力", []string{"紅美鈴"}, 10, 8, 9)
	add(done, 2, "かまくらの中で", "ななしさん", []string{"チルノ", "ほのぼの"}, 7, 6)
	add(done, 3, "白い庭", "居独", []string{"魂魄妖夢"}, 9, 10, 10, 8)
	// 管理画面の確認用：受付中コンペに「怪しい票」と普通の票を入れておく
	for _, e := range a.st.db.Entries {
		if e.ContestID != open.ID {
			continue
		}
		if e.No == 1 {
			for i, cm := range []string{"最高でした！", "最高でした", "とても良かったです"} {
				a.st.db.Votes = append(a.st.db.Votes, &Vote{ID: newID(), EntryID: e.ID, Name: "名無し", Comment: cm,
					VoterKey: hashKey("demo", "sus"+string(rune('a'+i))), IPHash: hashKey("demo", "1.2.3.4"),
					Points: 10, CreatedAt: now.Add(-time.Hour + time.Duration(i)*2*time.Minute)})
			}
		} else {
			a.st.db.Votes = append(a.st.db.Votes, &Vote{ID: newID(), EntryID: e.ID, Name: "通りすがり", Comment: "月見団子が食べたくなりました",
				VoterKey: hashKey("demo", "ok"), IPHash: hashKey("demo", "5.6.7.8"), Points: 7, CreatedAt: now.Add(-5 * time.Hour)})
		}
	}
	a.st.save()
	log.Printf("デモ用コンペを作成しました（デモ作品の編集パスワード: demo）")
}
