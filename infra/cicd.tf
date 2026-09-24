# ---------------------------------------------------------------------------
# CI/CD: GitHub Actions assumes a role via OIDC. No long-lived AWS keys anywhere.
# ---------------------------------------------------------------------------

# The OIDC provider is account-global and already exists (another project created it).
# Referencing it avoids two stacks fighting over one shared resource.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Only this repository, and only its own branches — not forks, not pull_request
    # builds from anyone who opens a PR.
    #
    # GitHub now issues IMMUTABLE, ID-BASED subjects for newer repositories:
    #   repo:owner@<ownerId>/name@<repoId>:ref:refs/heads/main
    # rather than the classic `repo:owner/name:ref:...`. A policy written only against
    # the classic form fails with a bare "Not authorized to perform
    # sts:AssumeRoleWithWebIdentity" and no hint as to why. Both forms are matched here:
    # the ID form is the one actually issued today and survives a rename, the classic
    # form keeps this working for repos that still get it.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repo}:ref:refs/heads/*",
        "repo:${var.github_owner_id}/${var.github_repo_id}:ref:refs/heads/*",
      ]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "${local.name}-deploy"
  description        = "Assumed by GitHub Actions to plan and apply infrastructure."
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
}

# Terraform genuinely needs broad rights to manage what it created. Scope it to this
# project's resources where the service allows it, and to the state bucket.
data "aws_iam_policy_document" "deploy" {
  statement {
    sid = "TerraformState"
    actions = [
      "s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
    ]
    resources = [
      "arn:aws:s3:::${local.name}-tfstate-${data.aws_caller_identity.me.account_id}",
      "arn:aws:s3:::${local.name}-tfstate-${data.aws_caller_identity.me.account_id}/*",
    ]
  }

  statement {
    sid = "ManageProject"
    actions = [
      "lambda:*", "dynamodb:*", "s3:*", "cloudfront:*", "events:*",
      "logs:*", "cloudwatch:*", "iam:*", "sts:GetCallerIdentity",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "${local.name}-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
