# ---------------------------------------------------------------------------
# Refresher: the only thing in the system that talks to Apple.
# ---------------------------------------------------------------------------

data "archive_file" "refresh" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/build"
  output_path = "${path.module}/.build/refresh.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "refresh" {
  name               = "${local.name}-refresh"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "refresh" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${var.region}:${data.aws_caller_identity.me.account_id}:*"]
  }

  statement {
    sid       = "Cache"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.cache.arn]
  }

  # Write only. The refresher never needs to read back what it published.
  statement {
    sid       = "PublishData"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.data.arn}/*"]
  }
}

resource "aws_iam_role_policy" "refresh" {
  name   = "${local.name}-refresh"
  role   = aws_iam_role.refresh.id
  policy = data.aws_iam_policy_document.refresh.json
}

resource "aws_cloudwatch_log_group" "refresh" {
  name              = "/aws/lambda/${local.name}-refresh"
  retention_in_days = 14
}

resource "aws_lambda_function" "refresh" {
  function_name = "${local.name}-refresh"
  role          = aws_iam_role.refresh.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]

  filename         = data.archive_file.refresh.output_path
  source_code_hash = data.archive_file.refresh.output_base64sha256

  # A full refresh is ~60 polite Apple requests plus fares for five origins.
  timeout     = 600
  memory_size = 512

  environment {
    variables = {
      CACHE_DRIVER         = "ddb"
      CACHE_TABLE          = aws_dynamodb_table.cache.name
      DATA_BUCKET          = aws_s3_bucket.data.id
      DATA_DIR             = "/var/task/data"
      TRAVELPAYOUTS_TOKEN  = var.travelpayouts_token
      TRAVELPAYOUTS_MARKER = var.travelpayouts_marker
      NODE_OPTIONS         = "--enable-source-maps"
    }
  }

  depends_on = [aws_cloudwatch_log_group.refresh]
}

# Two cadences. Stock moves by the minute, so the matrix refreshes fast; fares move
# slowly and each one costs an upstream call, so they run on their own slow rule.
resource "aws_cloudwatch_event_rule" "stock" {
  name                = "${local.name}-stock"
  description         = "Refresh market stock and pricing"
  schedule_expression = var.stock_schedule
}

resource "aws_cloudwatch_event_target" "stock" {
  rule      = aws_cloudwatch_event_rule.stock.name
  target_id = "lambda"
  arn       = aws_lambda_function.refresh.arn
  input     = jsonencode({ only = "matrix" })
}

resource "aws_cloudwatch_event_rule" "flights" {
  name                = "${local.name}-flights"
  description         = "Refresh round-trip fares"
  schedule_expression = var.flights_schedule
}

resource "aws_cloudwatch_event_target" "flights" {
  rule      = aws_cloudwatch_event_rule.flights.name
  target_id = "lambda"
  arn       = aws_lambda_function.refresh.arn
  input     = jsonencode({ only = "flights" })
}

resource "aws_lambda_permission" "events_stock" {
  statement_id  = "AllowEventBridgeStock"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.refresh.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.stock.arn
}

resource "aws_lambda_permission" "events_flights" {
  statement_id  = "AllowEventBridgeFlights"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.refresh.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.flights.arn
}

# A refresh that fails silently is a board that quietly goes stale.
resource "aws_cloudwatch_metric_alarm" "refresh_errors" {
  alarm_name          = "${local.name}-refresh-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 21600
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_description   = "The iphone-hunter refresher errored; data is going stale."

  dimensions = {
    FunctionName = aws_lambda_function.refresh.function_name
  }
}

# ---------------------------------------------------------------------------
# Live check: answers "is it there right now" for one market, on demand.
# Same bundle, different handler — one source of truth for the Apple logic.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "check" {
  name               = "${local.name}-check"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "check" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${var.region}:${data.aws_caller_identity.me.account_id}:*"]
  }

  # Cache only. This function never publishes, so it gets no S3 access at all.
  statement {
    sid       = "Cache"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.cache.arn]
  }
}

resource "aws_iam_role_policy" "check" {
  name   = "${local.name}-check"
  role   = aws_iam_role.check.id
  policy = data.aws_iam_policy_document.check.json
}

resource "aws_cloudwatch_log_group" "check" {
  name              = "/aws/lambda/${local.name}-check"
  retention_in_days = 14
}

resource "aws_lambda_function" "check" {
  function_name = "${local.name}-check"
  role          = aws_iam_role.check.arn
  handler       = "check.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]

  filename         = data.archive_file.refresh.output_path
  source_code_hash = data.archive_file.refresh.output_base64sha256

  # One market, two batched requests. If it has not answered in 30s it will not.
  timeout     = 30
  memory_size = 256

  environment {
    variables = {
      CACHE_DRIVER    = "ddb"
      CACHE_TABLE     = aws_dynamodb_table.cache.name
      DATA_DIR        = "/var/task/data"
      ALLOWED_ORIGINS = join(",", var.allowed_origins)
    }
  }

  depends_on = [aws_cloudwatch_log_group.check]
}

resource "aws_lambda_function_url" "check" {
  function_name      = aws_lambda_function.check.function_name
  authorization_type = "NONE" # public read-only lookup; the DynamoDB cache is the throttle

  cors {
    allow_origins = var.allowed_origins
    allow_methods = ["GET"]
    max_age       = 600
  }
}

output "check_url" {
  description = "On-demand live availability endpoint."
  value       = aws_lambda_function_url.check.function_url
}
