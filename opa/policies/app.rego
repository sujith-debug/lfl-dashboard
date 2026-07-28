package permission.app

import rego.v1

# Development policy for the local OPA sidecar. Production policies are owned
# by the central OPA repository and delivered to the sidecar as an S3 bundle.
default allow := false

supported_actions := {
	"access_panel",
	"project_list",
	"project_read",
	"project_create",
	"project_update",
	"project_archive",
	"analytics_read",
	"analytics_query",
}

# The template allows authenticated users to exercise its reference module.
# Replace this with product roles/permissions before using it in production.
allow if {
	input.user.id != ""
	input.resource.action in supported_actions
}
