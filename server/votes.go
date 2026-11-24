package main

import (
	"net/http"
	"sort"
	"strings"
	"time"
)

const (
	MaxPoints     = 10
	MinCommentLen = 5    // 投票時の感想の最低文字数
	MaxCommentLen = 1000 // 投票時の感想の最大文字数

	// 「短時間に集中」の判定：同じ作品へ BurstWindow 以内に BurstCount 票以上
	BurstWindow = 10 * time.Minute
	BurstCount  = 3
)

// 一般公開用の票（キーやIPは出さない）
type PublicVote struct {
	Name      string    `json:"name"`
	Points    int       `json:"points"`
	Comment   string    `json:"comment"`
	CreatedAt time.Time `json:"createdAt"`
}

func publicVote(v *Vote) PublicVote {
	return PublicVote{Name: v.Name, Points: v.Points, Comment: v.Comment, CreatedAt: v.CreatedAt}
}

// ---- 投票（ポイント＋一言感想） ----

func (a *App) vote(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Points  int
		Comment string
		Name    string
	}
	if !readJSON(w, r, &in) {
		return
	}
	key := r.Header.Get("X-Voter-Key")
	if len(key) < 16 || len(key) > 128 {
		fail(w, 400, "投票キーが不正です。ページを再読み込みしてください")
		return
	}
	in.Comment = strings.TrimSpace(in.Comment)
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		in.Name = "名無し"
	}
	switch {
	case in.Points < 0 || in.Points > MaxPoints:
		fail(w, 400, "ポイントが範囲外です")
		return
	case in.Points > 0 && runeLen(in.Comment) < MinCommentLen:
		fail(w, 400, "投票には一言感想（5文字以上）が必要です")
		return
	case runeLen(in.Comment) > MaxCommentLen:
		fail(w, 400, "感想は1000文字までです")
		return
	case runeLen(in.Name) > 50:
		fail(w, 400, "ハンドルネームは50文字までです")
		return
	}

	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	e := a.entryByID(r.PathValue("id"))
	if e == nil {
		fail(w, 404, "作品が見つかりません")
		return
	}
	ph := a.contestByID(e.ContestID).Phase(a.now())
	if ph != PhaseSubmission && ph != PhaseVoting {
		fail(w, 403, "投票期間外です")
		return
	}
	hk := hashKey(a.secret, key)
	ih := hashKey(a.secret, clientIP(r))
	for i, v := range a.st.db.Votes {
		if v.EntryID != e.ID {
			continue
		}
		if v.VoterKey == hk {
			if in.Points == 0 { // 0 は投票の取り消し
				a.st.db.Votes = append(a.st.db.Votes[:i], a.st.db.Votes[i+1:]...)
				a.st.save()
				writeJSON(w, 200, map[string]any{"myVote": nil})
				return
			}
			v.Points, v.Comment, v.Name = in.Points, in.Comment, in.Name
			a.st.save()
			writeJSON(w, 200, map[string]any{"myVote": publicVote(v)})
			return
		}
		if a.strictIP && v.IPHash == ih {
			fail(w, 409, "この環境からは既に投票済みです")
			return
		}
	}
	if in.Points == 0 {
		writeJSON(w, 200, map[string]any{"myVote": nil})
		return
	}
	v := &Vote{ID: newID(), EntryID: e.ID, Name: in.Name, Comment: in.Comment,
		VoterKey: hk, IPHash: ih, Points: in.Points, CreatedAt: a.now()}
	a.st.db.Votes = append(a.st.db.Votes, v)
	a.st.save()
	writeJSON(w, 200, map[string]any{"myVote": publicVote(v)})
}

// ---- 管理者：票の偏りチェック ----

type ReviewVote struct {
	ID         string    `json:"id"`
	EntryID    string    `json:"entryId"`
	EntryNo    int       `json:"entryNo"`
	EntryTitle string    `json:"entryTitle"`
	Name       string    `json:"name"`
	Points     int       `json:"points"`
	Comment    string    `json:"comment"`
	CreatedAt  time.Time `json:"createdAt"`
	IP         string    `json:"ip"`    // IPハッシュの先頭（同じ値なら同じIP）
	Voter      string    `json:"voter"` // ブラウザキーのハッシュの先頭
	Flags      []string  `json:"flags"`
}

type ReviewEntry struct {
	ID      string `json:"id"`
	No      int    `json:"no"`
	Title   string `json:"title"`
	PenName string `json:"penName"`
	Total   int    `json:"total"`
	Count   int    `json:"count"`
	Flagged int    `json:"flagged"`
}

const (
	FlagBurst   = "短時間に集中"
	FlagSameIP  = "同じIPから複数票"
	FlagSameTxt = "同じ感想文"
)

func (a *App) reviewVotes(w http.ResponseWriter, r *http.Request) {
	a.st.mu.RLock()
	defer a.st.mu.RUnlock()
	c := a.contestByID(r.PathValue("id"))
	if c == nil {
		fail(w, 404, "コンペが見つかりません")
		return
	}
	entries := map[string]*Entry{}
	for _, e := range a.entriesOf(c.ID) {
		entries[e.ID] = e
	}
	var votes []*Vote
	for _, v := range a.st.db.Votes {
		if entries[v.EntryID] != nil {
			votes = append(votes, v)
		}
	}
	flags := map[string]map[string]bool{}
	flag := func(v *Vote, f string) {
		if flags[v.ID] == nil {
			flags[v.ID] = map[string]bool{}
		}
		flags[v.ID][f] = true
	}

	byEntry := map[string][]*Vote{}
	for _, v := range votes {
		byEntry[v.EntryID] = append(byEntry[v.EntryID], v)
	}
	for _, vs := range byEntry {
		sort.Slice(vs, func(i, j int) bool { return vs[i].CreatedAt.Before(vs[j].CreatedAt) })
		// ① 短時間に集中：前後 BurstWindow 以内の票が BurstCount 以上
		for i, v := range vs {
			n := 0
			for _, u := range vs {
				d := u.CreatedAt.Sub(v.CreatedAt)
				if d >= -BurstWindow && d <= BurstWindow {
					n++
				}
			}
			if n >= BurstCount {
				flag(vs[i], FlagBurst)
			}
		}
		// ② 同じIPから、別ブラウザ扱いで同じ作品に複数票
		byIP := map[string][]*Vote{}
		for _, v := range vs {
			if v.IPHash != "" {
				byIP[v.IPHash] = append(byIP[v.IPHash], v)
			}
		}
		for _, g := range byIP {
			if len(g) >= 2 {
				for _, v := range g {
					flag(v, FlagSameIP)
				}
			}
		}
	}
	// ③ コンペ内で同じ感想文（空白・記号の違いは無視）
	norm := func(s string) string {
		return strings.Map(func(r rune) rune {
			if strings.ContainsRune(" 　\n\t。、！!？?…・〜~ー-", r) {
				return -1
			}
			return r
		}, strings.ToLower(s))
	}
	byTxt := map[string][]*Vote{}
	for _, v := range votes {
		if t := norm(v.Comment); t != "" {
			byTxt[t] = append(byTxt[t], v)
		}
	}
	for _, g := range byTxt {
		if len(g) >= 2 {
			for _, v := range g {
				flag(v, FlagSameTxt)
			}
		}
	}

	short := func(s string) string {
		if len(s) > 6 {
			return s[:6]
		}
		return s
	}
	out := []ReviewVote{}
	sum := map[string]*ReviewEntry{}
	for id, e := range entries {
		sum[id] = &ReviewEntry{ID: e.ID, No: e.No, Title: e.Title, PenName: e.PenName}
	}
	for _, v := range votes {
		e := entries[v.EntryID]
		rv := ReviewVote{ID: v.ID, EntryID: e.ID, EntryNo: e.No, EntryTitle: e.Title, Name: v.Name,
			Points: v.Points, Comment: v.Comment, CreatedAt: v.CreatedAt,
			IP: short(v.IPHash), Voter: short(v.VoterKey), Flags: []string{}}
		for _, f := range []string{FlagBurst, FlagSameIP, FlagSameTxt} {
			if flags[v.ID][f] {
				rv.Flags = append(rv.Flags, f)
			}
		}
		s := sum[e.ID]
		s.Total += v.Points
		s.Count++
		if len(rv.Flags) > 0 {
			s.Flagged++
		}
		out = append(out, rv)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	es := []*ReviewEntry{}
	for _, s := range sum {
		es = append(es, s)
	}
	sort.Slice(es, func(i, j int) bool { return es[i].No < es[j].No })
	writeJSON(w, 200, map[string]any{"contest": a.contestView(c), "entries": es, "votes": out,
		"rule": map[string]any{"burstMinutes": int(BurstWindow.Minutes()), "burstCount": BurstCount}})
}

func (a *App) deleteVote(w http.ResponseWriter, r *http.Request) {
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	id := r.PathValue("id")
	n := len(a.st.db.Votes)
	a.st.db.Votes = filter(a.st.db.Votes, func(v *Vote) bool { return v.ID != id })
	if len(a.st.db.Votes) == n {
		fail(w, 404, "票が見つかりません")
		return
	}
	a.st.save()
	writeJSON(w, 200, map[string]bool{"ok": true})
}
