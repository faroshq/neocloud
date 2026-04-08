.PHONY: build build-platform build-cli build-console clean generate lint test tidy codegen crds tools verify-codegen docker-platform docker-console run-console console-dev layer1-dev-up layer1-dev-down layer1-dev-status layer1-dev-kubeconfig layer2-dev-up layer2-dev-down layer3-dev-up layer3-dev-down run-dev dev-login dev-up dev-down demo-vm demo-vm-clean lima-up lima-down lima-kubeconfig lima-status zitadel-up zitadel-down

PLATFORM_DIR := src/platform
CONSOLE_DIR := src/console
BINARY_DIR := bin

# Tool versions (matching kedge)
CONTROLLER_GEN_VER := v0.16.5
CONTROLLER_GEN_BIN := controller-gen
CONTROLLER_GEN := $(PLATFORM_DIR)/hack/tools/$(CONTROLLER_GEN_BIN)-$(CONTROLLER_GEN_VER)
export CONTROLLER_GEN

KCP_APIGEN_VER := v0.30.0
KCP_APIGEN_BIN := apigen
KCP_APIGEN_GEN := $(PLATFORM_DIR)/hack/tools/$(KCP_APIGEN_BIN)-$(KCP_APIGEN_VER)
export KCP_APIGEN_GEN

GO_INSTALL := $(PLATFORM_DIR)/hack/go-install.sh
TOOLS_GOBIN_DIR := $(abspath $(PLATFORM_DIR)/hack/tools)

# --- Build ---

build: build-platform build-cli

build-platform:
	cd $(PLATFORM_DIR) && go build -o ../../$(BINARY_DIR)/platform ./cmd/platform

build-cli:
	cd $(PLATFORM_DIR) && go build -o ../../$(BINARY_DIR)/platform-cli ./cmd/cli

build-console: ## Build the Piral console app shell
	cd $(CONSOLE_DIR) && npm install --workspaces && cd app-shell && npm run build

console-dev: ## Run console in dev mode (hot reload on :1234)
	cd $(CONSOLE_DIR) && npm install --workspaces && cd app-shell && npm run start

docker-platform: ## Build platform Docker image
	cd $(PLATFORM_DIR) && docker build -t platform:latest .

docker-console: ## Build console Docker image
	cd $(CONSOLE_DIR) && docker build -t platform-console:latest .

run-console: docker-console ## Build and run NeoCloud console via Docker
	docker rm -f platform-console 2>/dev/null || true
	docker run --name platform-console -p 4466:4466 platform-console:latest
	@echo "Console running at http://localhost:4466/"

# --- Code generation ---

crds: $(CONTROLLER_GEN) $(KCP_APIGEN_GEN) ## Generate CRDs, deepcopy, and kcp APIResourceSchemas
	cd $(PLATFORM_DIR) && ./hack/update-codegen-crds.sh

codegen: crds ## Generate all (CRDs + kcp resources + deepcopy)

verify-codegen: codegen ## Verify codegen is up to date
	@if ! git diff --quiet HEAD -- $(PLATFORM_DIR); then \
		echo "ERROR: codegen produced a diff. Please run 'make codegen' and commit the result."; \
		git diff --stat HEAD -- $(PLATFORM_DIR); \
		exit 1; \
	fi

# --- Tools ---

tools: $(CONTROLLER_GEN) $(KCP_APIGEN_GEN) ## Install all dev tools

$(CONTROLLER_GEN):
	GOBIN=$(TOOLS_GOBIN_DIR) $(GO_INSTALL) sigs.k8s.io/controller-tools/cmd/controller-gen $(CONTROLLER_GEN_BIN) $(CONTROLLER_GEN_VER)

$(KCP_APIGEN_GEN):
	GOBIN=$(TOOLS_GOBIN_DIR) $(GO_INSTALL) github.com/kcp-dev/sdk/cmd/apigen $(KCP_APIGEN_BIN) $(KCP_APIGEN_VER)

# --- Standard targets ---

clean:
	rm -rf $(BINARY_DIR)
	rm -rf $(PLATFORM_DIR)/hack/tools
	rm -rf $(CONSOLE_DIR)/app-shell/dist $(CONSOLE_DIR)/app-shell/node_modules
	rm -rf $(CONSOLE_DIR)/pilets/*/dist $(CONSOLE_DIR)/pilets/*/node_modules
	rm -rf $(CONSOLE_DIR)/node_modules

generate:
	cd $(PLATFORM_DIR) && go generate ./...

test:
	cd $(PLATFORM_DIR) && go test ./... -count=1

lint:
	cd $(PLATFORM_DIR) && golangci-lint run ./...

tidy:
	cd $(PLATFORM_DIR) && go mod tidy

# --- Dev environment ---
# Zitadel credentials (dev):
#   Username: zitadel-admin@zitadel.localhost
#   Password: Password1!
#   https://localhost:10443/ui/console?login_hint=zitadel-admin@zitadel.localhost

ZITADEL_COMPOSE_DIR := deploy/layer2-platform/dev/zitadel-compose
LAYER1_SCRIPTS := deploy/layer1-infra/dev/scripts
WORKLOAD_KUBECONFIG ?= .platform-data/workload-kubeconfig

OIDC_ISSUER_URL ?= https://localhost:10443
OIDC_CLIENT_ID ?= 366808256712106243
CONSOLE_ADDR ?= localhost:1234

# --- Layer 1: Infrastructure (3-node Lima cluster) ---

layer1-dev-up: ## Create 3-node dev cluster (mgmt + cpu + gpu workers)
	$(LAYER1_SCRIPTS)/up.sh

layer1-dev-down: ## Tear down all Lima VMs
	$(LAYER1_SCRIPTS)/down.sh

layer1-dev-status: ## Check cluster and KubeVirt status
	$(LAYER1_SCRIPTS)/status.sh

layer1-dev-kubeconfig: ## Extract kubeconfig from management node
	$(LAYER1_SCRIPTS)/kubeconfig.sh

# --- Layer 2: Platform (Zitadel OIDC) ---

layer2-dev-up: layer2-dev-certs ## Start Zitadel via docker-compose
	cd $(ZITADEL_COMPOSE_DIR) && docker compose up -d --wait

layer2-dev-certs: ## Generate self-signed TLS certs for Zitadel (localhost)
	@if [ ! -f $(ZITADEL_COMPOSE_DIR)/certs/localhost.crt ]; then \
		echo "Generating self-signed TLS certificate for localhost..."; \
		openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
			-keyout $(ZITADEL_COMPOSE_DIR)/certs/localhost.key \
			-out $(ZITADEL_COMPOSE_DIR)/certs/localhost.crt \
			-days 3650 -subj "/CN=localhost" \
			-addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
			-addext "basicConstraints=critical,CA:TRUE" \
			-addext "keyUsage=critical,digitalSignature,keyCertSign" \
			-addext "extendedKeyUsage=serverAuth"; \
	fi

layer2-dev-down: ## Stop Zitadel
	cd $(ZITADEL_COMPOSE_DIR) && docker compose down

# --- Layer 3: Production services (stubs) ---

layer3-dev-up: ## Stub — no dev dependencies for layer 3 yet
	@echo "Layer 3 dev: no-op (billing/monitoring skipped in dev mode)"

layer3-dev-down: ## Stub
	@echo "Layer 3 dev: nothing to tear down"

# --- Run ---

run-dev: build-platform layer2-dev-up ## Run platform with embedded kcp, console proxy, Zitadel OIDC, and workload cluster
	./$(BINARY_DIR)/platform start \
		--embedded-kcp \
		--dev-mode \
		--console-addr $(CONSOLE_ADDR) \
		--oidc-issuer-url $(OIDC_ISSUER_URL) \
		--oidc-ca-file $(ZITADEL_COMPOSE_DIR)/certs/localhost.crt \
		$(if $(OIDC_CLIENT_ID),--oidc-client-id $(OIDC_CLIENT_ID),) \
		$(if $(wildcard $(WORKLOAD_KUBECONFIG)),--workload-kubeconfig $(WORKLOAD_KUBECONFIG),)

dev-login: build-cli ## Login to local dev platform via OIDC
	./$(BINARY_DIR)/platform-cli login \
		--hub-url https://localhost:9443 \
		--insecure-skip-tls-verify

demo-vm: ## Create a demo VM on the workload cluster
	KUBECONFIG=$(WORKLOAD_KUBECONFIG) kubectl apply -f deploy/layer1-infra/prod/kubevirt/demo-vm.yaml
	@echo "Waiting for VM to start..."
	KUBECONFIG=$(WORKLOAD_KUBECONFIG) kubectl wait vm/demo-vm --for=condition=Ready --timeout=180s
	@echo ""
	@echo "Demo VM is running. Access it with:"
	@echo "  KUBECONFIG=$(WORKLOAD_KUBECONFIG) virtctl console demo-vm"
	@echo "  (login: root / demo)"

demo-vm-clean: ## Delete the demo VM
	KUBECONFIG=$(WORKLOAD_KUBECONFIG) kubectl delete -f deploy/layer1-infra/prod/kubevirt/demo-vm.yaml --ignore-not-found

# --- Full dev environment lifecycle ---

dev-up: layer1-dev-up layer1-dev-kubeconfig layer2-dev-up ## Bring up all dev dependencies
	@echo "Dev environment ready. Run 'make run-dev' to start the platform."

dev-down: layer2-dev-down layer1-dev-down ## Tear down all dev dependencies

# --- Backward compatibility aliases ---

lima-up: layer1-dev-up
lima-down: layer1-dev-down
lima-kubeconfig: layer1-dev-kubeconfig
lima-status: layer1-dev-status
zitadel-up: layer2-dev-up
zitadel-down: layer2-dev-down
