# Bootstrap: the Terraform state bucket itself cannot live in the state it stores.
# This runs once with local state; everything else uses the S3 backend it creates.
#
#   cd infra/bootstrap && terraform init && terraform apply

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = "iphone-hunter"
      ManagedBy = "terraform"
    }
  }
}

variable "region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

data "aws_caller_identity" "me" {}

resource "aws_s3_bucket" "state" {
  bucket = "iphone-hunter-tfstate-${data.aws_caller_identity.me.account_id}"

  # State is the one thing that must never be casually destroyed.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "state_bucket" {
  value = aws_s3_bucket.state.id
}

output "backend_config" {
  description = "Paste into infra/backend.tf"
  value       = <<-EOT
    bucket       = "${aws_s3_bucket.state.id}"
    key          = "infra/terraform.tfstate"
    region       = "${var.region}"
    encrypt      = true
    use_lockfile = true
  EOT
}
