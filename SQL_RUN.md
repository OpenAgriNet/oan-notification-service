# OAN Notification Service — DB Runbook

## Connection Details

| Field    | Value                  |
|----------|------------------------|
| Host     | `10.230.0.3`           |
| Port     | `5432`                 |
| User     | `postgres`             |
| Dev DB   | `oan_notification`     |
| Prod DB  | `oan_notification_prod`|
| Password | `1a]D[]hs9Hxy|#GV`     |

---

## 1. Run Schema Scripts

```bash
PGPASSWORD='1a]D[]hs9Hxy|#GV' psql -h 10.230.0.3 -p 5432 -U postgres -d oan_notification_prod -f db_scheme.sql
PGPASSWORD='1a]D[]hs9Hxy|#GV' psql -h 10.230.0.3 -p 5432 -U postgres -d oan_notification_prod -f schema.sql
```

---

## 2. Generate Insert SQL from CSV

```bash
node generate-insert.js
```

> Reads `new-weather.csv` → outputs `insert.sql` in batches of 500

---

## 3. Truncate & Reinsert (Dev + Prod)

### Truncate

```bash
PGPASSWORD='1a]D[]hs9Hxy|#GV' psql -h 10.230.0.3 -p 5432 -U postgres -d oan_notification_prod -c "TRUNCATE advisory_notifications;"
PGPASSWORD='1a]D[]hs9Hxy|#GV' psql -h 10.230.0.3 -p 5432 -U postgres -d oan_notification -c "TRUNCATE advisory_notifications;"
```

### Reinsert

```bash
PGPASSWORD='1a]D[]hs9Hxy|#GV' psql -h 10.230.0.3 -p 5432 -U postgres -d oan_notification_prod -f insert.sql
PGPASSWORD='1a]D[]hs9Hxy|#GV' psql -h 10.230.0.3 -p 5432 -U postgres -d oan_notification -f insert.sql
```

---

## 4. Verify Counts

```bash
PGPASSWORD='1a]D[]hs9Hxy|#GV' psql -h 10.230.0.3 -p 5432 -U postgres -d oan_notification_prod -c "SELECT 'advisory_notifications' AS table_name, COUNT(*) FROM advisory_notifications UNION ALL SELECT 'subdistricts', COUNT(*) FROM subdistricts;"
PGPASSWORD='1a]D[]hs9Hxy|#GV' psql -h 10.230.0.3 -p 5432 -U postgres -d oan_notification -c "SELECT 'advisory_notifications' AS table_name, COUNT(*) FROM advisory_notifications UNION ALL SELECT 'subdistricts', COUNT(*) FROM subdistricts;"
```

Expected: `advisory_notifications = 6310`, `subdistricts = 6995`

---

## 5. Check Table Structure & Indexes

```bash
PGPASSWORD='1a]D[]hs9Hxy|#GV' psql -h 10.230.0.3 -p 5432 -U postgres -d oan_notification_prod -c "\d advisory_notifications"
```

### Expected Indexes

| Index                          | Column(s)               |
|-------------------------------|--------------------------|
| `advisory_notifications_pkey` | `message_id` (PK)        |
| `idx_adv_date_range`          | `from_date, to_date`     |
| `idx_adv_district_code`       | `district_code`          |
| `idx_adv_iitm_id`             | `unique_id_iitm`         |
| `idx_adv_lang`                | `lang_abb`               |
| `idx_adv_pm_kisan_id`         | `unique_id_pm_kisan`     |
| `idx_adv_state_code`          | `state_code`             |
| `idx_adv_subdistrict_code`    | `subdistrict_code`       |
| `idx_adv_template`            | `template_abbreviation`  |

---

## 6. Translate Hindi Messages (older data)

### Export English rows with `lang_abb = hi`

```bash
PGPASSWORD='1a]D[]hs9Hxy|#GV' psql -h 10.230.0.3 -p 5432 -U postgres -d oan_notification -c "SELECT row_to_json(t) FROM (SELECT * FROM advisory_notifications WHERE TRIM(lang_abb) = 'hi' AND created_at < '2026-05-27' ORDER BY created_at DESC) t;" -t -A -o output.json
```

### Run translation script

```bash
export ANTHROPIC_API_KEY=your_api_key_here
node translate_and_update.js output.json update_hindi.sql
```

### Apply updates

```bash
PGPASSWORD='1a]D[]hs9Hxy|#GV' psql -h 10.230.0.3 -p 5432 -U postgres -d oan_notification -f update_hindi.sql
```

---

## 7. Useful Queries

### Distinct states
```sql
SELECT DISTINCT state_name FROM advisory_notifications ORDER BY state_name;
```

### Districts for a state
```sql
SELECT DISTINCT district_name FROM advisory_notifications WHERE state_name = 'Bihar' ORDER BY district_name;
```

### Count by lang
```sql
SELECT TRIM(lang_abb) AS lang, COUNT(*) FROM advisory_notifications GROUP BY TRIM(lang_abb);
```

### Check duplicates
```sql
SELECT unique_id_iitm, lang_abb, from_date, COUNT(*)
FROM advisory_notifications
GROUP BY unique_id_iitm, lang_abb, from_date
HAVING COUNT(*) > 1
LIMIT 10;
```