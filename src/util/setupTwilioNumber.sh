#!/bin/bash

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
else
  echo ".env file not found."
  exit 1
fi

# Check required variables
if [ -z "$TWILIO_ACCOUNT_SID" ] || [ -z "$TWILIO_AUTH_TOKEN" ]; then
  echo "TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set in .env"
  exit 1
fi

# Your webhook domain (e.g., NGROK_DOMAIN)
if [ -z "$NGROK_DOMAIN" ]; then
  echo "NGROK_DOMAIN not set in .env"
  exit 1
fi

# Webhook URL
WEBHOOK_URL="https://${NGROK_DOMAIN}/twiml"

echo "Searching for available US phone numbers..."

response=$(curl -s -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/AvailablePhoneNumbers/US/Local.json?SmsEnabled=true&VoiceEnabled=true&Limit=1")

PHONE_NUMBER=$(echo "$response" | grep -oE '\+1[0-9]+' | head -n 1)

if [ -z "$PHONE_NUMBER" ]; then
  echo "No phone number found."
  exit 1
fi

echo "Buying phone number: $PHONE_NUMBER..."

purchase_response=$(curl -s -X POST -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers.json \
  --data-urlencode "PhoneNumber=$PHONE_NUMBER" \
  --data-urlencode "VoiceUrl=$WEBHOOK_URL")

SID=$(echo "$purchase_response" | grep -oE '"sid":\s*"[A-Za-z0-9]+"' | cut -d'"' -f4)

if [ -z "$SID" ]; then
  echo "Failed to purchase number. Response:"
  echo "$purchase_response"
  exit 1
fi

echo "Phone number purchased successfully. SID: $SID"

# Append to .env
echo -e "\nTWILIO_PHONE_NUMBER=\"$PHONE_NUMBER\"" >> .env
echo "Phone number $PHONE_NUMBER saved to .env"
