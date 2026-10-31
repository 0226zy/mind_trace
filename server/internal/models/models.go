package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"
)

type User struct {
	ID        uint64    `gorm:"primaryKey" json:"id"`
	OpenID    string    `gorm:"size:64;uniqueIndex;not null" json:"-"`
	Nickname  string    `gorm:"size:100" json:"nickname"`
	AvatarURL string    `gorm:"size:1024" json:"avatarUrl"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	Thoughts  []Thought `gorm:"foreignKey:UserID;constraint:fk_thoughts_user,OnDelete:CASCADE" json:"-"`
	Records   []Record  `gorm:"foreignKey:UserID;constraint:fk_records_user,OnDelete:CASCADE" json:"-"`
}

type Thought struct {
	ID           uint64    `gorm:"primaryKey" json:"id"`
	UserID       uint64    `gorm:"not null;index:idx_thoughts_user_status;index:idx_thoughts_user_created" json:"-"`
	TriggerEvent string    `gorm:"size:100;not null" json:"triggerEvent"`
	Emotions     Emotions  `gorm:"type:json" json:"emotions"`
	Status       string    `gorm:"size:16;not null;default:active;index:idx_thoughts_user_status;check:chk_thoughts_status,status IN ('active','resolved','recurring')" json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	Records      []Record  `gorm:"foreignKey:ThoughtID;constraint:fk_records_thought,OnDelete:CASCADE" json:"-"`
}

type Action struct {
	Text string `json:"text"`
	Done bool   `json:"done"`
}

type UncontrollableItem struct {
	Text       string `json:"text"`
	CrossedOut bool   `json:"crossedOut"`
}

type Record struct {
	ID                  uint64              `gorm:"primaryKey" json:"id"`
	ThoughtID           uint64              `gorm:"not null;uniqueIndex:uk_records_thought_version;index:idx_records_user_status;index:idx_records_user_created" json:"thoughtId"`
	UserID              uint64              `gorm:"not null;index:idx_records_user_status;index:idx_records_user_created;uniqueIndex:uk_records_user_client_request" json:"-"`
	ClientRequestID     *string             `gorm:"size:64;uniqueIndex:uk_records_user_client_request" json:"clientRequestId"`
	VersionNo           int                 `gorm:"not null;uniqueIndex:uk_records_thought_version" json:"versionNo"`
	TriggerEvent        string              `gorm:"size:100;not null" json:"triggerEvent"`
	Emotions            Emotions            `gorm:"type:json" json:"emotions"`
	Intensity           *int                `gorm:"check:chk_records_intensity,intensity IS NULL OR intensity BETWEEN 1 AND 10" json:"intensity"`
	LoopThought         string              `gorm:"size:1000;not null" json:"loopThought"`
	Status              string              `gorm:"size:16;not null;default:registered;index:idx_records_user_status;check:chk_records_status,status IN ('registered','evaluating','paused','closed')" json:"status"`
	Step                int                 `gorm:"not null;default:0;check:chk_records_step,step BETWEEN 0 AND 7" json:"step"`
	RuminationType      string              `gorm:"size:100" json:"ruminationType"`
	RiskContent         string              `gorm:"type:text" json:"riskContent"`
	Probability         *int                `gorm:"check:chk_records_probability,probability IS NULL OR probability BETWEEN 0 AND 100" json:"probability"`
	ControllableActions Actions             `gorm:"type:json" json:"controllableActions"`
	UncontrollableItems UncontrollableItems `gorm:"type:json" json:"uncontrollableItems"`
	ScenarioWorst       string              `gorm:"type:text" json:"scenarioWorst"`
	ScenarioLikely      string              `gorm:"type:text" json:"scenarioLikely"`
	ScenarioBest        string              `gorm:"type:text" json:"scenarioBest"`
	CloseConfirmations  Confirmations       `gorm:"type:json" json:"closeConfirmations"`
	CreatedAt           time.Time           `json:"createdAt"`
	UpdatedAt           time.Time           `json:"updatedAt"`
	ClosedAt            *time.Time          `json:"closedAt"`
}

type Emotions []string
type Actions []Action
type UncontrollableItems []UncontrollableItem
type Confirmations []bool

func (e Emotions) Value() (driver.Value, error)            { return jsonValue(e) }
func (a Actions) Value() (driver.Value, error)             { return jsonValue(a) }
func (u UncontrollableItems) Value() (driver.Value, error) { return jsonValue(u) }
func (c Confirmations) Value() (driver.Value, error)       { return jsonValue(c) }
func (e *Emotions) Scan(src any) error                     { return jsonScan(src, e) }
func (a *Actions) Scan(src any) error                      { return jsonScan(src, a) }
func (u *UncontrollableItems) Scan(src any) error          { return jsonScan(src, u) }
func (c *Confirmations) Scan(src any) error                { return jsonScan(src, c) }

func jsonValue(value any) (driver.Value, error) {
	data, err := json.Marshal(value)
	return string(data), err
}

func jsonScan(src any, target any) error {
	var data []byte
	switch value := src.(type) {
	case []byte:
		data = value
	case string:
		data = []byte(value)
	case nil:
		data = []byte("null")
	default:
		return fmt.Errorf("unsupported JSON database value %T", src)
	}
	return json.Unmarshal(data, target)
}
