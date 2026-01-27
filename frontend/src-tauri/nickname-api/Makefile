APP_NAME := nickname-api

.PHONY: build run test

build:
	cd cmd/server && go build -o ../../bin/$(APP_NAME)

run: build
	./bin/$(APP_NAME)

test:
	go test ./...
