#!/bin/bash

# Load the .env file into the environment
export $(cat .env | xargs)

# Check if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are set
if [ -z "$TWILIO_ACCOUNT_SID" ] || [ -z "$TWILIO_AUTH_TOKEN" ]; then
  echo "Error: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in the .env file"
  exit 1
fi

response=$(curl -X POST "https://iam.twilio.com/v1/Keys" \
--data-urlencode "FriendlyName=Forge in a box CR" \
--data-urlencode "AccountSid=$TWILIO_ACCOUNT_SID" \
-u $TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN)

# Parse values without 
apiKeySid=$(echo "$response" | grep -o '"sid": *"[^"]*"' | sed 's/"sid": *"\([^"]*\)"/\1/')
apiKeySecret=$(echo "$response" | grep -o '"secret": *"[^"]*"' | sed 's/"secret": *"\([^"]*\)"/\1/')

# Validate success
if [ -z "$apiKeySid" ] || [ -z "$apiKeySecret" ]; then
  echo "Error: Failed to create API key. Response: $response"
  exit 1
fi

# Append to .env
echo -e "\nTWILIO_API_KEY_SID=$apiKeySid" >> .env
echo "TWILIO_API_KEY_SECRET=$apiKeySecret" >> .env

# Confirm
echo "API Key created successfully!"
echo "SID: $apiKeySid"
echo "Secret: $apiKeySecret"
