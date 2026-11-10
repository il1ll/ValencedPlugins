import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Dispatcher } from '@valenced/discord/common/flux'
import { Stores } from '@valenced/discord/flux'
import {
	addSettingsItemToSection,
	onSettingsModulesLoaded,
	registerSettingsItem,
} from '@valenced/discord/modules/settings'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import Settings from './settings'
import { defaults, splitIds } from './storage'
import type { PluginApi } from '@valenced/plugins/types'
import type { KeywordTrackerSettings } from './storage'

type Api = PluginApi<{ jsonStorage: KeywordTrackerSettings }>

const SETTINGS_KEY = 'COM_CODER_KEYWORD_TRACKER'

let pluginApi: Api | undefined

function KeywordTrackerScreen() {
	return pluginApi ? <Settings api={pluginApi} /> : null
}

const escapeRegex = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function matchKeyword(s: KeywordTrackerSettings, fullContent: string) {
	for (const kw of s.keywords) {
		let content = fullContent
		let testKw = kw

		if (!s.caseSensitive) {
			content = content.toLowerCase()
			testKw = testKw.toLowerCase()
		}

		let isMatch: boolean
		if (s.exactMatch) {
			isMatch = content === testKw
		} else if (s.wholeWords) {
			isMatch = new RegExp(
				`\\b${escapeRegex(testKw)}\\b`,
				s.caseSensitive ? '' : 'i',
			).test(content)
		} else if (s.inSentence) {
			isMatch = content.includes(testKw)
		} else {
			isMatch = new RegExp(
				`\\b${escapeRegex(testKw)}\\b`,
				s.caseSensitive ? '' : 'i',
			).test(fullContent)
		}

		if (isMatch) return kw
	}
}

function buildReport(m: any, c: any, keyword: string) {
	const author = m.author
	const GuildStore = Stores.GuildStore as any

	let text = '# **Keyword Detected!**\n\n'
	text += `**User:** <@${author.id}>\n`
	text += `    Username: \`@${author.username}\`\n`
	text += `    ID: \`${author.id}\`\n`
	text += `**Keyword:** \`${keyword}\`\n`
	text += `**Message:**\n${m.content || '[Embed Message]'}\n`

	if (c.guild_id) {
		const g = GuildStore.getGuild(c.guild_id)
		text += '**Location:** Server\n'
		text += '**Server:**\n'
		text += `    Name: \`${g?.name}\`\n`
		text += `    ID: \`${c.guild_id}\`\n`
		text += `**Channel:** <#${c.id}>\n`
		text += `    Name: \`${c.name}\`\n`
		text += `    ID: \`${c.id}\`\n`
		text += `**Message Link:** https://discord.com/channels/${c.guild_id}/${c.id}/${m.id}`
	} else if (c.type === 3) {
		text += '**Location:** Group\n'
		text += `**Group:** <#${c.id}>\n`
		text += `    Name: \`${c.name || 'Unnamed Group'}\`\n`
		text += `    ID: \`${c.id}\`\n`
		text += `**Message Link:** https://discord.com/channels/@me/${c.id}/${m.id}`
	} else {
		text += '**Location:** DM\n'
		text += `**Message Link:** https://discord.com/channels/@me/${c.id}/${m.id}`
	}

	return text
}

function onMessage(payload: any) {
	const s: KeywordTrackerSettings = {
		...defaults,
		...pluginApi?.jsonStorage.cache,
	}
	const m = payload?.message
	if (!m || !s.keywords.length) return

	const UserStore = Stores.UserStore as any
	const ChannelStore = Stores.ChannelStore as any
	const GuildStore = Stores.GuildStore as any
	const RelationshipStore = Stores.RelationshipStore as any

	let fullContent: string = m.content || ''

	if (s.trackEmbeds && Array.isArray(m.embeds)) {
		for (const embed of m.embeds) {
			if (embed.title) fullContent += ` ${embed.title}`
			if (embed.description) fullContent += ` ${embed.description}`
			if (Array.isArray(embed.fields))
				for (const f of embed.fields) {
					if (f.name) fullContent += ` ${f.name}`
					if (f.value) fullContent += ` ${f.value}`
				}
		}
	}

	if (!fullContent) return

	const authorId = m.author?.id
	if (!authorId || authorId === UserStore.getCurrentUser()?.id) return
	if (s.ignoreBots && m.author?.bot) return

	if (s.ignoreUsersEnabled && splitIds(s.ignoredUserIds).includes(authorId))
		return

	if (s.trackMode === 'friends') {
		if (!RelationshipStore.getFriendIDs().includes(authorId)) return
	} else if (s.trackMode === 'custom') {
		if (!splitIds(s.customIds).includes(authorId)) return
	}

	const c = ChannelStore.getChannel(m.channel_id)
	if (!c) return

	if (s.ignoreChannelsEnabled && splitIds(s.ignoredChannelIds).includes(c.id))
		return

	const isTrackedChannel =
		s.trackChannelsEnabled && splitIds(s.trackedChannelIds).includes(c.id)

	if (!isTrackedChannel) {
		if (
			c.guild_id &&
			s.ignoreServersEnabled &&
			splitIds(s.ignoredServerIds).includes(c.guild_id)
		)
			return

		if (c.guild_id && !s.trackServers) return
		if (c.type === 3 && !s.trackGroups) return
		if ((c.type === 1 || (c.type === 0 && !c.guild_id)) && !s.trackDMs) return
	}

	const keyword = matchKeyword(s, fullContent)
	if (!keyword) return

	const authorName = m.author.username
	const targetChannelId = s.targetChannelId.trim()
	const webhookUrl = s.webhookUrl.trim()
	const sendToChannel = s.sendNotificationToChannel && targetChannelId
	const sendToWebhook = s.sendNotificationToWebhook && webhookUrl

	if (sendToChannel || sendToWebhook) {
		const content = buildReport(m, c, keyword)

		if (sendToChannel) {
			const [RestAPI] = lookupModule(withProps<any>('getAPIBaseURL', 'post'))
			RestAPI?.post({
				url: `/channels/${targetChannelId}/messages`,
				body: { content },
			}).catch(() => {})
		}

		if (sendToWebhook) {
			fetch(webhookUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content }),
			}).catch(() => {})
		}

		ToastActionCreators.open('KEYWORD_TRACKER', {
			text: `${authorName} sent a tracked message`,
		})
		return
	}

	let location = 'DM'
	if (c.guild_id) {
		const g = GuildStore.getGuild(c.guild_id)
		location = `Server: ${g?.name} #${c.name}`
	} else if (c.type === 3) {
		location = `Group: ${c.name || 'Unnamed'}`
	}

	ToastActionCreators.open('KEYWORD_TRACKER', {
		text: `${authorName} said "${keyword}" in ${location}`,
	})
}

export default plugin<{ jsonStorage: KeywordTrackerSettings }>({
	jsonStorage: {
		load: true,
		default: defaults,
	},
	start(api) {
		pluginApi = api
		const { cleanup } = api

		Dispatcher.subscribe('MESSAGE_CREATE', onMessage)
		cleanup(
			() => Dispatcher.unsubscribe('MESSAGE_CREATE', onMessage),
			() => {
				pluginApi = undefined
			},
		)

		cleanup(
			onSettingsModulesLoaded(() => {
				cleanup(
					registerSettingsItem(SETTINGS_KEY, {
						parent: null,
						type: 'route',
						IconComponent: () => <TableRowAssetIcon name="ChatCheckIcon" />,
						useTitle: () => 'Keyword Tracker',
						usePredicate: () =>
							(api.jsonStorage.use() ?? defaults).showInSettings !== false,
						screen: {
							route: 'CoderKeywordTracker',
							getComponent: () => KeywordTrackerScreen,
						},
					}),
					addSettingsItemToSection('VALENCED', SETTINGS_KEY),
				)
			}),
		)
	},
	SettingsComponent: Settings,
})
