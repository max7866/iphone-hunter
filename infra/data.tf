# ---------------------------------------------------------------------------
# Cache: the thing that stands between public traffic and Apple.
# ---------------------------------------------------------------------------

resource "aws_dynamodb_table" "cache" {
  name         = "${local.name}-cache"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "k"

  attribute {
    name = "k"
    type = "S"
  }

  # Freshness is enforced in code; this only stops the table growing forever.
  ttl {
    attribute_name = "expires"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = false # it is a cache; losing it costs one slow refresh
  }
}

# ---------------------------------------------------------------------------
# Data bucket: private, reachable only through CloudFront.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "data" {
  bucket = "${local.name}-data-${data.aws_caller_identity.me.account_id}"
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "data" {
  name                              = "${local.name}-data"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# The site is served from GitHub Pages, so the data origin must answer cross-origin.
resource "aws_cloudfront_response_headers_policy" "cors" {
  name = "${local.name}-cors"

  cors_config {
    origin_override                  = true
    access_control_allow_credentials = false

    access_control_allow_headers {
      items = ["*"]
    }
    access_control_allow_methods {
      items = ["GET", "HEAD", "OPTIONS"]
    }
    access_control_allow_origins {
      items = var.allowed_origins
    }
    access_control_max_age_sec = 600
  }

  security_headers_config {
    content_type_options {
      override = true
    }
    strict_transport_security {
      override                   = true
      access_control_max_age_sec = 31536000
      include_subdomains         = true
    }
  }
}

resource "aws_cloudfront_distribution" "data" {
  enabled         = true
  comment         = "${local.name} data API"
  price_class     = "PriceClass_100" # NA + EU is plenty for a JSON payload
  is_ipv6_enabled = true

  origin {
    domain_name              = aws_s3_bucket.data.bucket_regional_domain_name
    origin_id                = "data"
    origin_access_control_id = aws_cloudfront_origin_access_control.data.id
  }

  default_cache_behavior {
    target_origin_id           = "data"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.cors.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.preflight.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_iam_policy_document" "data_bucket" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.data.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.data.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "data" {
  bucket = aws_s3_bucket.data.id
  policy = data.aws_iam_policy_document.data_bucket.json
}

# A CORS preflight is forwarded to the origin, and S3 behind OAC answers 403 — the bucket
# never sees the Origin header because the cache policy does not forward it. S3-level CORS
# rules cannot fix that. Answer OPTIONS at the edge instead, before it reaches the bucket.
resource "aws_cloudfront_function" "preflight" {
  name    = "${local.name}-preflight"
  runtime = "cloudfront-js-2.0"
  comment = "Answer CORS preflight at the edge; S3 behind OAC cannot."
  publish = true
  code    = <<-JS
    var ALLOWED = ${jsonencode(var.allowed_origins)};

    function handler(event) {
      var req = event.request;
      if (req.method !== 'OPTIONS') return req;

      // Echo back the origin that actually asked, when it is one we allow. Answering
      // with a fixed origin would fail every caller except the first in the list.
      var origin = req.headers.origin && req.headers.origin.value;
      var allow = ALLOWED.indexOf(origin) !== -1 ? origin : ALLOWED[0];

      return {
        statusCode: 204,
        statusDescription: 'No Content',
        headers: {
          'access-control-allow-origin':  { value: allow },
          'access-control-allow-methods': { value: 'GET, HEAD, OPTIONS' },
          'access-control-allow-headers': { value: '*' },
          'access-control-max-age':       { value: '600' },
          'vary':                         { value: 'Origin' }
        }
      };
    }
  JS
}
