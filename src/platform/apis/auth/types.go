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

// Package auth contains authentication types for the platform.
package auth

// LoginResponse contains login callback data.
type LoginResponse struct {
	Kubeconfig []byte `json:"kubeconfig,omitempty"`
	Email      string `json:"email,omitempty"`
	UserID     string `json:"userId,omitempty"`
}
