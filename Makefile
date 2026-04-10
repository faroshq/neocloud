.PHONY: build build-platform build-cli build-console clean generate lint test tidy codegen crds tools verify-codegen docker-platform docker-console run-console console-dev layer1-dev-up layer1-dev-down layer1-dev-status layer1-dev-kubeconfig lima-up lima-down lima-status lima-kubeconfig layer2-dev-up layer2-dev-down layer3-dev-up layer3-dev-down dev-lima-up dev-lima-down dev-lima-run dev-lima-login dev-integration-up dev-integration-down demo-vm demo-vm-clean zitadel-up zitadel-down

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

GOLANGCI_LINT_VER := v2.11.4
GOLANGCI_LINT_BIN := golangci-lint
GOLANGCI_LINT := $(PLATFORM_DIR)/hack/tools/$(GOLANGCI_LINT_BIN)-$(GOLANGCI_LINT_VER)
export GOLANGCI_LINT

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

tools: $(CONTROLLER_GEN) $(KCP_APIGEN_GEN) $(GOLANGCI_LINT) ## Install all dev tools

$(CONTROLLER_GEN):
	GOBIN=$(TOOLS_GOBIN_DIR) $(GO_INSTALL) sigs.k8s.io/controller-tools/cmd/controller-gen $(CONTROLLER_GEN_BIN) $(CONTROLLER_GEN_VER)

$(KCP_APIGEN_GEN):
	GOBIN=$(TOOLS_GOBIN_DIR) $(GO_INSTALL) github.com/kcp-dev/sdk/cmd/apigen $(KCP_APIGEN_BIN) $(KCP_APIGEN_VER)

$(GOLANGCI_LINT):
	GOBIN=$(TOOLS_GOBIN_DIR) $(GO_INSTALL) github.com/golangci/golangci-lint/v2/cmd/golangci-lint $(GOLANGCI_LINT_BIN) $(GOLANGCI_LINT_VER)

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

lint: $(GOLANGCI_LINT)
	cd $(PLATFORM_DIR) && $(abspath $(GOLANGCI_LINT)) run ./...

tidy:
	cd $(PLATFORM_DIR) && go mod tidy

# --- Dev environment ---
# Zitadel credentials (dev):
#   Username: zitadel-admin@zitadel.localhost
#   Password: Password1!
#   https://localhost:10443/ui/console?login_hint=zitadel-admin@zitadel.localhost

ZITADEL_COMPOSE_DIR := deploy/layer2-platform/dev/zitadel-compose
LIMA_CONFIG := deploy/layer2-platform/dev/lima/kubevirt-dev.yaml
LIMA_VM_NAME := kubevirt-dev
LAYER1_SCRIPTS := deploy/layer1-infra/dev/scripts
LAYER2_INTEGRATION_SCRIPTS := deploy/layer2-platform/dev/integration
WORKLOAD_KUBECONFIG ?= .platform-data/workload-kubeconfig

OIDC_ISSUER_URL ?= https://localhost:10443
CONSOLE_ADDR ?= localhost:1234
SEED_OUTPUT := $(ZITADEL_COMPOSE_DIR)/.seed-output

# --- Layer 1: Infrastructure (Linux only, libvirt + Metal3) ---
# Requires a Linux host with KVM. Produces a kubeconfig.
# For macOS dev, use Lima targets below instead.

make : ## [Linux] Create dev cluster: libvirt VMs + Metal3 + Ironic + Ubuntu
	$(LAYER1_SCRIPTS)/up.sh

layer1-dev-down: ## [Linux] Tear down all libvirt VMs and networks
	$(LAYER1_SCRIPTS)/down.sh

layer1-dev-status: ## [Linux] Check VM, Metal3, and cluster status
	$(LAYER1_SCRIPTS)/status.sh

layer1-dev-kubeconfig: ## [Linux] Extract kubeconfig from management VM
	$(LAYER1_SCRIPTS)/kubeconfig.sh

# --- Lima: Local workload cluster (macOS/Linux, replaces Layer 1 for dev) ---
# Provides k3s + KubeVirt in a Lima VM. Same output as Layer 1: a kubeconfig.

lima-up: ## Create Lima VM with k3s + KubeVirt (workload cluster)
	limactl start --name $(LIMA_VM_NAME) $(LIMA_CONFIG)
	@mkdir -p .platform-data
	limactl shell $(LIMA_VM_NAME) sudo cat /root/kubeconfig-external > $(WORKLOAD_KUBECONFIG)
	@echo "Workload cluster ready. Kubeconfig: $(WORKLOAD_KUBECONFIG)"

lima-down: ## Delete Lima workload VM
	limactl delete --force $(LIMA_VM_NAME) 2>/dev/null || true
	rm -f $(WORKLOAD_KUBECONFIG)

lima-status: ## Show Lima VM status
	limactl list $(LIMA_VM_NAME) 2>/dev/null || echo "VM not found"

lima-kubeconfig: ## Extract kubeconfig from Lima VM
	@mkdir -p .platform-data
	limactl shell $(LIMA_VM_NAME) sudo cat /root/kubeconfig-external > $(WORKLOAD_KUBECONFIG)
	@echo "Kubeconfig written to $(WORKLOAD_KUBECONFIG)"

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

layer2-dev-seed: layer2-dev-up ## Seed OIDC apps in Zitadel (idempotent)
	$(ZITADEL_COMPOSE_DIR)/seed-apps.sh

layer2-dev-down: ## Stop Zitadel
	cd $(ZITADEL_COMPOSE_DIR) && docker compose down

# --- Layer 3: Production services (stubs) ---

layer3-dev-up: ## Stub — no dev dependencies for layer 3 yet
	@echo "Layer 3 dev: no-op (billing/monitoring skipped in dev mode)"

layer3-dev-down: ## Stub
	@echo "Layer 3 dev: nothing to tear down"

# ===========================================================================
# Dev Lima: Local dev with Lima VM + embedded kcp + Zitadel docker-compose
# Fast iteration cycle for code changes. macOS or Linux.
# ===========================================================================

dev-lima-up: lima-up layer2-dev-up ## [Lima] Bring up Lima VM + Zitadel (full local dev env)
	@echo "Dev environment ready. Run 'make dev-lima-run' to start the platform."

dev-lima-down: layer2-dev-down lima-down ## [Lima] Tear down Lima VM + Zitadel

dev-lima-run: build-platform layer2-dev-seed ## [Lima] Run platform with embedded kcp + Zitadel OIDC
	$(eval include $(SEED_OUTPUT))
	./$(BINARY_DIR)/platform start \
		--embedded-kcp \
		--dev-mode \
		--console-addr $(CONSOLE_ADDR) \
		--oidc-issuer-url $(OIDC_ISSUER_URL) \
		--oidc-ca-file $(ZITADEL_COMPOSE_DIR)/certs/localhost.crt \
		--oidc-client-id $(OIDC_WEB_CLIENT_ID) \
		$(if $(wildcard $(WORKLOAD_KUBECONFIG)),--workload-kubeconfig $(WORKLOAD_KUBECONFIG),)

dev-lima-login: build-cli ## [Lima] Login to local dev platform via OIDC
	./$(BINARY_DIR)/platform-cli login \
		--hub-url https://localhost:9443 \
		--insecure-skip-tls-verify

# ===========================================================================
# Dev Integration: Layer1 libvirt cluster + prod-like Layer2 deployment
# Deploys kcp, Zitadel, operators on the cluster — close to production.
# Requires: make layer1-dev-up first (Linux only).
# ===========================================================================

dev-integration-up: ## [Integration] Deploy Layer2 prod manifests onto Layer1 cluster
	$(LAYER2_INTEGRATION_SCRIPTS)/up.sh

dev-integration-down: ## [Integration] Remove Layer2 from Layer1 cluster
	$(LAYER2_INTEGRATION_SCRIPTS)/down.sh

# ===========================================================================
# Shared utilities
# ===========================================================================

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

# --- Backward compatibility aliases ---

zitadel-up: layer2-dev-up
zitadel-down: layer2-dev-down
