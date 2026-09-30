export async function flushSettings(client, tenantId, settings) {
  await client.query(
    `INSERT INTO settings
       (tenant_id, agent_name, greeting, allow_calendar, allow_booking,
        allow_summaries, allow_personal_data, allow_bank_data, sms_summary_opt_in, language,
        agent_style, allow_research, allow_call_memory)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (tenant_id) DO UPDATE SET
       agent_name=EXCLUDED.agent_name, greeting=EXCLUDED.greeting,
       allow_calendar=EXCLUDED.allow_calendar, allow_booking=EXCLUDED.allow_booking,
       allow_summaries=EXCLUDED.allow_summaries, allow_personal_data=EXCLUDED.allow_personal_data,
       allow_bank_data=EXCLUDED.allow_bank_data, sms_summary_opt_in=EXCLUDED.sms_summary_opt_in,
       language=EXCLUDED.language, agent_style=EXCLUDED.agent_style,
       allow_research=EXCLUDED.allow_research, allow_call_memory=EXCLUDED.allow_call_memory`,
    [
      tenantId,
      settings.agentName,
      settings.greeting,
      settings.allowCalendar,
      settings.allowBooking,
      settings.allowSummaries,
      settings.allowPersonalData,
      settings.allowBankData,
      settings.smsSummaryOptIn,
      settings.language,
      settings.agentStyle ?? null,
      settings.allowResearch ?? false,
      settings.allowCallMemory ?? false,
    ],
  );
}
