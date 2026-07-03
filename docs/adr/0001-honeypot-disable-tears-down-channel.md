# Honeypot Disable Tears Down Channel

The honeypot setup command creates its own safety category and trap channel. Disabling the honeypot deletes those bot-created Discord objects instead of only pausing enforcement, because a dormant honeypot channel is confusing and can invite accidental posts without providing protection.
