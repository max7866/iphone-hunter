terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
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

data "aws_caller_identity" "me" {}

variable "region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Name prefix for every resource."
  type        = string
  default     = "iphone-hunter"
}

variable "travelpayouts_token" {
  description = "Travelpayouts API token. Supply via TF_VAR_travelpayouts_token, never a .tfvars file."
  type        = string
  sensitive   = true
}

variable "travelpayouts_marker" {
  description = "Travelpayouts affiliate marker. Public by design, but kept with the token."
  type        = string
  default     = ""
}

variable "refresh_schedule" {
  description = "How often the refresher runs. Apple's endpoints are undocumented and not meant for bulk access, so this stays conservative."
  type        = string
  default     = "rate(6 hours)"
}

variable "allowed_origins" {
  description = "Browser origins permitted to read the data API."
  type        = list(string)
  default = [
    "https://max7866.github.io",
    "http://localhost:8799",
    "http://127.0.0.1:8799",
  ]
}

variable "github_repo" {
  description = "owner/name of the repo allowed to deploy via OIDC."
  type        = string
  default     = "max7866/iphone-hunter"
}

locals {
  name = var.project
}
