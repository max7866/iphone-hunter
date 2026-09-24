output "data_url" {
  description = "Base URL the site fetches its data from."
  value       = "https://${aws_cloudfront_distribution.data.domain_name}"
}

output "data_bucket" {
  value = aws_s3_bucket.data.id
}

output "cache_table" {
  value = aws_dynamodb_table.cache.name
}

output "refresh_function" {
  value = aws_lambda_function.refresh.function_name
}

output "deploy_role_arn" {
  description = "Set as the AWS_DEPLOY_ROLE secret in GitHub."
  value       = aws_iam_role.deploy.arn
}
