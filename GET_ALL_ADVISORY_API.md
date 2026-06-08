# GET /api/notification/all

Returns all advisory notifications joined with their subdistrict geometry, including a `lat`/`lon` centroid for each record. Designed for two use cases:

- **Table view** — paginated, sortable list of advisories
- **Map view** — full unpaginated dump of all matching points for a given date range or all time

---

## Endpoint

```
GET /api/notification/all
```

---

## Query Parameters

All parameters are optional.

| Parameter    | Type    | Default | Constraints          | Description |
|--------------|---------|---------|----------------------|-------------|
| `lang`       | string  | —       | 2-char ISO code      | Filter by language (`en`, `hi`, `gu`, etc.) |
| `state_code` | integer | —       | —                    | Filter by state code |
| `from_date`  | string  | —       | `YYYY-MM-DD`         | Include advisories whose `valid_from` is on or after this date |
| `to_date`    | string  | —       | `YYYY-MM-DD`         | Include advisories whose `valid_to` is on or before this date |
| `active_only`| boolean | `false` | `true` / `false`     | When `true`, returns only advisories valid today (overrides `from_date`/`to_date`) |
| `page`       | integer | `1`     | ≥ 1                  | Page number (ignored when `limit=0`) |
| `limit`      | integer | `100`   | `0` – `20000`        | Records per page. **Set to `0` to disable pagination and return all matching records** (hard cap: 20,000 rows) |

### Date filtering behaviour

| Params used | What is returned |
|---|---|
| Neither `from_date` nor `to_date` | All-time data |
| `from_date` only | Advisories with `valid_from ≥ from_date` |
| `to_date` only | Advisories with `valid_to ≤ to_date` |
| Both `from_date` and `to_date` | Advisories whose validity window falls within the range |
| `active_only=true` | Advisories valid as of today (`valid_from ≤ today ≤ valid_to`) |

---

## Response

### Success — paginated (default)

```json
{
  "success": true,
  "total": 342,
  "page": 1,
  "limit": 100,
  "pages": 4,
  "unpaginated": false,
  "data": [ /* see record shape below */ ],
  "error": null
}
```

### Success — unpaginated (`limit=0`, for maps)

```json
{
  "success": true,
  "total": 342,
  "page": null,
  "limit": null,
  "pages": null,
  "unpaginated": true,
  "data": [ /* all 342 records */ ],
  "error": null
}
```

### Error

```json
{
  "success": false,
  "total": 0,
  "page": 1,
  "limit": 100,
  "pages": 0,
  "unpaginated": false,
  "data": [],
  "error": {
    "code": "DB_ERROR",
    "message": "..."
  }
}
```

---

## Record Shape (`data[]`)

| Field               | Type            | Nullable | Description |
|---------------------|-----------------|----------|-------------|
| `message_id`        | string (UUID)   | No       | Unique advisory ID |
| `unique_id_iitm`    | string          | No       | IITM subdistrict identifier (used for the spatial join) |
| `subdistrict_code`  | integer         | No       | Subdistrict administrative code |
| `subdistrict_name`  | string          | Yes      | Subdistrict name |
| `district_code`     | integer         | No       | District administrative code |
| `district_name`     | string          | Yes      | District name |
| `state_code`        | integer         | No       | State administrative code |
| `state_name`        | string          | Yes      | State name |
| `lang`              | string          | No       | Language code (`en`, `hi`, `gu`, …) |
| `forecast_message`  | string          | Yes      | Full advisory text |
| `template`          | string          | Yes      | Template abbreviation (e.g. `2bin_v2_bv`) |
| `type`              | string (enum)   | No       | `WEATHER_ADVISORY` or `GENERAL` |
| `priority`          | string (enum)   | No       | `HIGH`, `MEDIUM`, or `LOW` |
| `valid_from`        | string (date)   | No       | Advisory validity start (`YYYY-MM-DD`) |
| `valid_to`          | string (date)   | No       | Advisory validity end (`YYYY-MM-DD`) |
| `created_at`        | string (ISO 8601)| No      | Record creation timestamp |
| `is_active`         | boolean         | No       | `true` if today falls within `valid_from`–`valid_to` |
| `lat`               | number          | Yes      | Centroid latitude of the subdistrict polygon (WGS84). `null` if no matching polygon exists in `subdistricts` |
| `lon`               | number          | Yes      | Centroid longitude of the subdistrict polygon (WGS84). `null` if no matching polygon exists in `subdistricts` |

> `lat`/`lon` come from `ST_Centroid` of the subdistrict's PostGIS geometry, transformed to WGS84 (EPSG:4326). If a record's `unique_id_iitm` has no geometry loaded yet, both fields are `null` — table rows will still appear, map pins should skip `null` coordinates.

---

## Example Requests

### Table view — page 2, English only

```
GET /api/notification/all?lang=en&page=2&limit=50
```

### Map view — all time, all languages

```
GET /api/notification/all?limit=0
```

### Map view — specific date range

```
GET /api/notification/all?limit=0&from_date=2026-06-01&to_date=2026-06-30
```

### Map view — only advisories active today

```
GET /api/notification/all?limit=0&active_only=true
```

### Filter by state + language for table

```
GET /api/notification/all?state_code=8&lang=hi&page=1&limit=100
```

---

## Example Record

```json
{
  "message_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "unique_id_iitm": "101885057",
  "subdistrict_code": 80453,
  "subdistrict_name": "Jalsu",
  "district_code": 804,
  "district_name": "Jaipur Urban",
  "state_code": 8,
  "state_name": "Rajasthan",
  "lang": "en",
  "forecast_message": "Moderate rainfall expected over the next 5 days. Farmers advised to postpone sowing.",
  "template": "2bin_v2_bv",
  "type": "WEATHER_ADVISORY",
  "priority": "HIGH",
  "valid_from": "2026-06-01",
  "valid_to": "2026-06-08",
  "created_at": "2026-06-01T08:00:00.000Z",
  "is_active": true,
  "lat": 26.9174,
  "lon": 75.8471
}
```

---

## Notes

- **No caching** — every request hits the database directly, so newly ingested records appear immediately.
- **Ordering** — results are always sorted by `created_at DESC` (newest first).
- **`limit=0` hard cap** — the server caps unpaginated responses at 20,000 rows to prevent runaway queries. If your dataset exceeds this, apply a date range filter to narrow results.
- **Geometry source** — coordinates come from the `subdistricts` table (PostGIS EPSG:3857 polygons). They are static per subdistrict and do not change when new advisories are ingested.
