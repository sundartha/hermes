const festgelegt = Date.parse(process.env.UHR_FESTGELEGT);
Date.now = () => festgelegt;
