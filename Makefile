.PHONY: test build mini-compile clean

test:
	cd server && go test ./... && go vet ./...
	cd miniprogram && node tests/run.js && node scripts/check-syntax.js && node cloudfunctions/mindTrace/test/domain.test.js
	cd web && npm run build

build:
	mkdir -p server/bin
	cd server && go build -o bin/mind-trace ./cmd/server
	cd web && npm run build

mini-compile:
	python3 "$(KIMI_SKILLS_ROOT)/mobile-app-building/skills/wechat-miniprogram-building/scripts/run.py" compile miniprogram artifacts/miniprogram-compiled.zip

clean:
	rm -rf server/bin web/dist artifacts
