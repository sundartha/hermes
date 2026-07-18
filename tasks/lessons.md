# Lessons (selbst gefundene Stolpersteine, fuer kuenftige Sessions)

## P3 (Peinlichkeits-Defekte: Cap/Reprompt/Inbound)

- **P3.3 kehrt eine bewusste Design-Entscheidung um.** Inbound-Minuten sehen den
  Budget-Guard nicht (`reconcileOutboundVoiceBudget` steigt bei Inbound aus) - der
  einzige Deckel ist `MAX_CALL_DURATION_S`. `MAX_EMPTY_TURNS` darf deshalb nie ueber 3
  gedreht werden.
