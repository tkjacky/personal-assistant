import { tool } from '@strands-agents/sdk'
import z from 'zod'

const TV_IP = process.env.TV_IP || 'localhost'
const TV_PORT = process.env.TV_PORT || '55000'

const KEY_CODES: Record<string, string> = {
  // Channels
  channel_up: 'NRC_CH_UP-ONOFF',
  channel_down: 'NRC_CH_DOWN-ONOFF',
  // Volume
  volume_up: 'NRC_VOLUP-ONOFF',
  volume_down: 'NRC_VOLDOWN-ONOFF',
  mute: 'NRC_MUTE-ONOFF',
  // Power
  power: 'NRC_POWER-ONOFF',
  // Navigation
  up: 'NRC_UP-ONOFF',
  down: 'NRC_DOWN-ONOFF',
  left: 'NRC_LEFT-ONOFF',
  right: 'NRC_RIGHT-ONOFF',
  ok: 'NRC_ENTER-ONOFF',
  back: 'NRC_RETURN-ONOFF',
  home: 'NRC_HOME-ONOFF',
  menu: 'NRC_MENU-ONOFF',
  // Numbers
  '0': 'NRC_D0-ONOFF',
  '1': 'NRC_D1-ONOFF',
  '2': 'NRC_D2-ONOFF',
  '3': 'NRC_D3-ONOFF',
  '4': 'NRC_D4-ONOFF',
  '5': 'NRC_D5-ONOFF',
  '6': 'NRC_D6-ONOFF',
  '7': 'NRC_D7-ONOFF',
  '8': 'NRC_D8-ONOFF',
  '9': 'NRC_D9-ONOFF',
  // Input
  input: 'NRC_CHG_INPUT-ONOFF',
  input_tv: 'NRC_TV-ONOFF',
  input_av: 'NRC_CHG_INPUT-ONOFF',
  // Guide
  guide: 'NRC_EPG-ONOFF',
}

async function sendKey(keyCode: string): Promise<string> {
  const url = `http://${TV_IP}:${TV_PORT}/nrc/control_0`
  const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:X_SendKey xmlns:u="urn:panasonic-com:service:p00NetworkControl:1">
      <X_KeyEvent>${keyCode}</X_KeyEvent>
    </u:X_SendKey>
  </s:Body>
</s:Envelope>`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPACTION': '"urn:panasonic-com:service:p00NetworkControl:1#X_SendKey"',
      },
      body,
    })

    if (!response.ok) {
      throw new Error(`TV returned ${response.status}`)
    }
  } catch {
    // Power off causes the TV to drop connection before responding — this is expected
    if (keyCode === 'NRC_POWER-ONOFF') return 'OK'
    throw new Error('TV not responding')
  }
  return 'OK'
}

/**
 * Control Panasonic VIERA TV via network.
 */
export const tvControl = tool({
  name: 'tv_control',
  description: `Control the Panasonic VIERA TV. Available commands: channel_up, channel_down, volume_up, volume_down, mute, power, up, down, left, right, ok, back, home, menu, guide, input, input_tv, input_av. Use "channel" command with a number or name to tune to a specific channel. Known channels: 99 VIUTV, 77 HOYTV, 81 TVB, 83 TVB新聞. For volume, user can specify how many steps (e.g. "大聲10格" → volume_up with repeat=10, "細聲3格" → volume_down with repeat=3). Default volume step is 5. Use input_tv to switch to TV input, input_av to switch to AV input.`,
  inputSchema: z.object({
    command: z.string().describe('The command: channel_up, channel_down, volume_up, volume_down, mute, power, up, down, left, right, ok, back, home, menu, guide, input, input_tv, input_av, or "channel" to tune to a specific channel number or name'),
    channel_number: z.number().optional().describe('The channel number to tune to (1-999). Only used when command is "channel". Known channels: 99=VIUTV, 77=HOYTV, 81=TVB, 83=TVB新聞'),
    repeat: z.number().optional().describe('Number of volume/channel steps to repeat. E.g. user says "大聲10格" → repeat=10. Default 5 for volume, 1 for others.'),
  }),
  callback: async (input) => {
    const { command, channel_number, repeat: rawRepeat } = input

    // Default repeat to 5 for volume commands, 1 for everything else
    const repeat = rawRepeat ?? (command === 'volume_up' || command === 'volume_down' ? 5 : 1)

    console.log(`\n📺 [tv_control] Command: "${command}"${channel_number ? ` Channel: ${channel_number}` : ''}${repeat > 1 ? ` Repeat: ${repeat}` : ''}`)

    try {
      // Handle direct channel tuning
      if (command === 'channel' && channel_number !== undefined) {
        const padded = String(channel_number).padStart(3, '0')
        for (const digit of padded) {
          await sendKey(KEY_CODES[digit])
          await new Promise(resolve => setTimeout(resolve, 300))
        }
        console.log(`📺 [tv_control] Tuned to channel ${padded}`)
        return `Done. Tuned to channel ${channel_number} (sent digits ${padded}).`
      }

      // Handle regular commands
      const keyCode = KEY_CODES[command]
      if (!keyCode) {
        const available = Object.keys(KEY_CODES).join(', ')
        return `Unknown command "${command}". Available: ${available}`
      }

      for (let i = 0; i < repeat; i++) {
        await sendKey(keyCode)
        if (i < repeat - 1) {
          await new Promise(resolve => setTimeout(resolve, 300))
        }
      }
      console.log(`📺 [tv_control] Success`)
      return `Done. Sent "${command}" ${repeat > 1 ? `x${repeat}` : ''} to TV.`
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.log(`📺 [tv_control] Error: ${errMsg}`)
      return `Failed to control TV: ${errMsg}`
    }
  },
})
