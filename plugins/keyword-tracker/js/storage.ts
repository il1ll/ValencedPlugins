export interface KeywordTrackerSettings {
	trackServers: boolean
	trackGroups: boolean
	trackDMs: boolean
	exactMatch: boolean
	wholeWords: boolean
	caseSensitive: boolean
	inSentence: boolean
	sendNotificationToChannel: boolean
	sendNotificationToWebhook: boolean
	keywords: string[]
	targetChannelId: string
	webhookUrl: string
	trackMode: 'everyone' | 'friends' | 'custom'
	customIds: string
	ignoreBots: boolean
	trackEmbeds: boolean
	trackChannelsEnabled: boolean
	trackedChannelIds: string
	ignoreServersEnabled: boolean
	ignoredServerIds: string
	ignoreChannelsEnabled: boolean
	ignoredChannelIds: string
	ignoreUsersEnabled: boolean
	ignoredUserIds: string
	showInSettings: boolean
}

export const defaults: KeywordTrackerSettings = {
	trackServers: true,
	trackGroups: true,
	trackDMs: true,
	exactMatch: false,
	wholeWords: true,
	caseSensitive: false,
	inSentence: true,
	sendNotificationToChannel: false,
	sendNotificationToWebhook: false,
	keywords: [],
	targetChannelId: '',
	webhookUrl: '',
	trackMode: 'everyone',
	customIds: '',
	ignoreBots: true,
	trackEmbeds: false,
	trackChannelsEnabled: false,
	trackedChannelIds: '',
	ignoreServersEnabled: false,
	ignoredServerIds: '',
	ignoreChannelsEnabled: false,
	ignoredChannelIds: '',
	ignoreUsersEnabled: false,
	ignoredUserIds: '',
	showInSettings: true,
}

export const splitIds = (value: string | undefined) =>
	(value ?? '')
		.split(',')
		.map(id => id.trim())
		.filter(Boolean)
