import { tool } from '@strands-agents/sdk'
import z from 'zod'

export const getCurrentDateTime = tool({
  name: 'get_current_date_time',
  description: 'Get the current date and time',
  inputSchema: z.object({}),
  callback: () => {
    return new Date().toLocaleString()
  },
})
