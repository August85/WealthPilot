# WealthPilot

Cross-border (US–India) financial planning: multi-currency net worth, RSUs, 401(k), EPF, FDs, home purchase and retirement scenarios. See [`spec.md`](spec.md) for the product spec, [`DECISIONS.md`](DECISIONS.md) for decisions, and [`docs/api-contract.md`](docs/api-contract.md) for the API.

> WealthPilot is planning software. It is not tax, legal or investment advice.

## Layout

```
apps/mobile/                  Expo / React Native app (iOS + Android)
apps/web/                     Next.js portal (later)
services/api/                 FastAPI modular monolith + worker
packages/calculation_engine/  Pure-Python financial calculations (golden-tested)
packages/contracts/           OpenAPI document + generated TypeScript types
docs/                         API contract, ADRs
```
