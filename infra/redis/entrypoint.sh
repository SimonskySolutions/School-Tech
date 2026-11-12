#!/bin/sh
# Generates the Redis ACL file from Docker secrets, then hands over to the
# official entrypoint, which drops root privileges before starting the server.
# Only SHA-256 hashes of the passwords are written; the file lives on tmpfs.
set -eu

acl_dir=/run/redis-acl
acl_file="$acl_dir/users.acl"

hash_secret() {
  # The hash covers the exact secret file contents, without a trailing newline.
  tr -d '\r\n' < "$1" | sha256sum | cut -d ' ' -f 1
}

queue_hash=$(hash_secret /run/secrets/redis_queue_password)
health_hash=$(hash_secret /run/secrets/redis_health_password)
admin_hash=$(hash_secret /run/secrets/redis_admin_password)

mkdir -p "$acl_dir"
umask 077
cat > "$acl_file" <<EOF
user default off resetkeys resetchannels -@all
user pyth_queue on #$queue_hash resetkeys ~pyth:* resetchannels &pyth:* -@all +@read +@write +@keyspace +@list +@hash +@set +@sortedset +@stream +@string +@bitmap +@scripting +@transaction +@pubsub +@connection +@fast +@slow -@dangerous +info +client|setname +client|getname +client|setinfo +client|id
user pyth_health on #$health_hash resetkeys resetchannels -@all +ping
user pyth_admin on #$admin_hash ~* &* +@all
EOF
# Monitoring (M8.6), where the secret exists: statistics only, no key or channel.
if [ -f /run/secrets/redis_monitor_password ]; then
  monitor_hash=$(hash_secret /run/secrets/redis_monitor_password)
  echo "user pyth_monitor on #$monitor_hash resetkeys resetchannels -@all +ping +info +config|get +slowlog|get +slowlog|len +latency|latest +client|setname +select" >> "$acl_file"
fi
chown -R redis:redis "$acl_dir"
chmod 600 "$acl_file"

exec docker-entrypoint.sh redis-server /usr/local/etc/redis/redis.conf "$@"
