terraform {
  backend "s3" {
    bucket       = "iphone-hunter-tfstate-076093951060"
    key          = "infra/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
