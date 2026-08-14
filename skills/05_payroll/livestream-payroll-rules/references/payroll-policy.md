# Payroll Policy

## Scope

This skill calculates one livestream session at a time.

## Validation Rules

1. Host ID must exist in `Portfolio_Master`.
2. Support ID must exist in `Support_Master` when the row is not `No_Support`.
3. Do not proceed when one row contains multiple Host or Support IDs.
4. Use actual TikTok live timestamps, not planned schedule slots.
5. Use only reconciled GMV:

```text
eligible_gmv = gross_gmv - returned_gmv
```

## Compensation Rules

### Host

```text
base_pay = live_hours × hourly_rate
commission_pay = eligible_gmv × commission_rate
gross_pay = base_pay + commission_pay
pit = gross_pay × 10%
net_pay = gross_pay - pit
```

Commission mode:

- `Thử việc`, `C`, `B`: fixed commission on the card
- `A`, `S`: use the 5 GMV tiers when the card note says `Theo Doanh thu`

### Support

```text
base_pay = live_hours × hourly_rate
commission_pay = 0
gross_pay = base_pay
pit = gross_pay × 10%
net_pay = gross_pay - pit
```

Support levels:

- `Cấp 1`
- `Cấp 2`
- `Cấp 3`
- `Cấp 4`

All four levels use `0%` commission.

## Hold Conditions

Return `hold/no-write` when:

- timestamps are invalid
- the rate card cannot resolve a grade or support level
- the session row is ambiguous
- the master ID lookup fails

## Reporting Format

Always include:

- source session reference
- actual live hours
- gross GMV
- returned GMV
- eligible GMV
- Host line item
- Support line item when present
- validation notes
