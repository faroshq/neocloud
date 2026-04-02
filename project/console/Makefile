.PHONY: install build dev clean docker-build

install:
	npm install --workspaces

build: install
	cd app-shell && npm run build

dev:
	cd app-shell && npm run start

clean:
	rm -rf app-shell/dist app-shell/node_modules
	rm -rf pilets/*/dist pilets/*/node_modules
	rm -rf node_modules

docker-build:
	docker build -t platform-console:latest .
