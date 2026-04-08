/*
Copyright 2026 The KCP Reference Architecture Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// Package kcp embeds kcp configuration files.
package kcp

import "embed"

// RootWorkspaceFS contains the platform workspace definition applied to the root workspace.
//
//go:embed workspace-platform.yaml
var RootWorkspaceFS embed.FS

// PlatformWorkspaceFS contains workspace definitions for children of root:platform.
//
//go:embed workspace-providers.yaml workspace-tenants.yaml
var PlatformWorkspaceFS embed.FS

// ProvidersFS contains APIResourceSchemas and APIExport applied to root:platform:providers.
//
//go:embed apiresourceschema-*.yaml apiexport-*.yaml
var ProvidersFS embed.FS
