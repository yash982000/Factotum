const { Collection, TextChannel, VoiceChannel, GuildCreateChannelOptions, MessageEmbed, Message } = require('discord.js');
const { CommandoClient } = require('discord.js-commando');
const winston = require('winston');
const { randomColor, sendMessageToMember, sendMsgToChannel } = require('../../discord-services');
const { messagePrompt, yesNoPrompt, chooseChannel } = require('../prompt');
const Activity = require('./activity');


/**
 * @typedef PollInfo
 * @property {String} type
 * @property {String} title
 * @property {String} question
 * @property {String} emojiName - emoji to use to call this poll
 * @property {Collection<String, String>} responses - <Emoji String, Description>
 */

/**
 * The Workshop class extends the Activity class. A workshop has a TA system to help users with 
 * questions. It also has polls the TAs can send to learn basic knowledge from the audience.
 * @class
 */
class Workshop extends Activity {

    /**
     * 
     * @constructor
     * @param {Activity.ActivityInfo} ActivityInfo
     * @param {Collection<String, Role>} [TARoles] - roles with TA permissions
     */
    constructor({activityName, guild, roleParticipants, botGuild}, TARoles) {
        super({activityName, guild, roleParticipants, botGuild});

        /**
         * @type {Collection<String, Role>} - roles with TA permissions
         */
        this.TARoles = TARoles || new Collection();

        /**
         * True if the assistance protocol is low tech.
         * @type {Boolean}
         */
        this.isLowTechSolution = false;

        /**
         * The channel where hackers can ask questions.
         * @type {TextChannel}
         */
        this.assistanceChannel;

        /**
         * The channels only available to TAs
         * @type {Collection<String, TextChannel | VoiceChannel>} - <Channel Name, channel>
         */
        this.TAChannels = new Collection();

        /**
         * TA Console where assistance calls are sent.
         * @type {TextChannel}
         */
        this.TAConsole;

        /**
         * The message where we show the wait list live.
         * @type {Message}
         */
        this.waitListEmbedMsg;

        /**
         * wait list Collection
         * @type {Collection<String, String>} - <User Id, Username>
         */
        this.waitlist = new Collection();

        /**
         * The polls available.
         * @type {Collection<String, PollInfo>} - <Poll type, PollInfo>
         */
        this.polls = new Collection;
    }


    /**
     * Initializes the workshop and adds the ta console, ta banter and assistance channel.
     * @override
     */
    async init() {
        await super.init();

        this.TAConsole = await this.addTAChannel('🧑🏽‍🏫ta-console', {
            type: 'text',
            topic: 'The TA console, here TAs can chat, communicate with the workshop lead, look at the wait list, and send polls!',
        }, [], true);

        this.addTAChannel('ta-banter', {
            topic: 'For TAs to talk without cluttering the console.',
        });

        this.assistanceChannel = await super.addChannelHelper('🙋🏽assistance', {
            type: 'text',
            topic: 'For hackers to request help from TAs for this workshop, please don\'t send any other messages!'
        }, [], true);

        this.botGuild.blackList.set(this.assistanceChannel.id, 3000);
        this.botGuild.save();

        winston.loggers.get(this.guild.id).event(`The activity ${this.name} was transformed to a workshop.`, {event: 'Activity'});

        return this;
    }


    /**
     * Adds extra workshop features, plus the regular features. Also adds default polls.
     * @override
     */
    addDefaultFeatures() {
        this.addDefaultPolls();

        /** @type {Activity.ActivityFeature[]} */
        let localFeatures = [];

        this.polls.forEach((pollInfo) => localFeatures.push({
            name: pollInfo.title,
            description: `Asks the question: ${pollInfo.title} - ${pollInfo.question}`,
            emoji: pollInfo.emojiName,
            callback: () => this.sendPoll(pollInfo.type),
        }));

        localFeatures.forEach(feature => this.features.set(feature.name, feature));

        super.addDefaultFeatures();
    }


    /**
     * Adds the default polls to the polls list.
     * @protected
     */
    addDefaultPolls() {
        /** @type {PollInfo[]} */
        let localPolls = [
            {
                title: 'Speed Poll!',
                type: 'Speed Poll',
                emojiName: '🏎️',
                question: 'Please react to this poll!',
                responses: new Collection([['🐢', 'Too Slow?'], ['🐶', 'Just Right?'], ['🐇', 'Too Fast?']]),
            },
            {
                title: 'Difficulty Poll!',
                type: 'Difficulty Poll',
                emojiName: '✍️',
                question: 'Please react to this poll! If you need help, go to the assistance channel!',
                responses: new Collection([['🐢', 'Too Hard?'], ['🐶', 'Just Right?'], ['🐇', 'Too Easy?']]),
            },
            {
                title: 'Explanation Poll!',
                type: 'Explanation Poll',
                emojiName: '🧑‍🏫',
                question: 'Please react to this poll!',
                responses: new Collection([['🐢', 'Hard to understand?'], ['🐶', 'Meh explanations?'], ['🐇', 'Easy to understand?']]),
            }
        ];

        localPolls.forEach(pollInfo => this.polls.set(pollInfo.type, pollInfo));
    }


    /**
     * Adds a channel to the activity, ask if it will be for TAs or not.
     * @param {TextChannel} channel - channel to prompt user
     * @param {String} userId - user to prompt for channel info
     * @override
     */
    async addChannel(channel, userId) {
        // ask if it will be for TA
        let isTa = await yesNoPrompt({ prompt: 'Is this channel for TAs?', channel, userId });

        if (isTa) {
            /** @type {TextChannel} */
            let newChannel = await super.addChannel(channel, userId);
            this.getTAChannelPermissions().forEach(rolePermission => newChannel.updateOverwrite(rolePermission.id, rolePermission.permissions));
            this.TAChannels.set(newChannel.name, newChannel);
        } else {
            super.addChannel(channel, userId);
        }
    }


    /**
     * Creates a channel only available to TAs.
     * @param {String} name 
     * @param {GuildCreateChannelOptions} info
     * @returns {Promise<TextChannel | VoiceChannel>}
     * @async 
     */
    async addTAChannel(name, info) {
        let channel = await super.addChannelHelper(name, info, this.getTAChannelPermissions());
        this.TAChannels.set(channel.name, channel);
        return channel;
    }


    /**
     * Returns the perms for a TA Channel
     * @protected
     * @returns {Activity.RolePermission[]}
     */
    getTAChannelPermissions() {
        /** The permissions for the TA channels */
        let TAChannelPermissions = [
            { id: this.botGuild.roleIDs.everyoneRole, permissions: { VIEW_CHANNEL: false } },
        ];

        // add regular activity members to the TA perms list as non tas, so they cant see that channel
        this.rolesAllowed.forEach(role => {
            TAChannelPermissions.push({id: role.id, permissions: {VIEW_CHANNEL: false}});

        });

        // Loop over ta roles, give them voice channel perms and add them to the TA permissions list
        this.TARoles.forEach(role => {
            TAChannelPermissions.push({id: role.id, permissions: {VIEW_CHANNEL: true}});
        });

        return TAChannelPermissions;
    }


    /**
     * FEATURES:
     */


    /**
     * Send a poll to the general text channel
     * @param {String} type - the type of poll to send
     * @async
     */
    async sendPoll(type, channel, userId) {
        let poll = this.polls.get(type);
        if (!poll) throw new Error('No poll was found of that type!');
        
        // create poll
        let description = poll.question + '\n\n';
        for (const key of poll.responses.keys()) {
            description += '**' + poll.responses.get(key) + '->** ' + key + '\n\n';
        }

        let qEmbed = new MessageEmbed()
            .setColor(this.botGuild.colors.embedColor)
            .setTitle(poll.title)
            .setDescription(description);

        // send poll to general text or prompt for channel
        let pollChannel;
        if ((await this.channels.generalText.fetch(true))) pollChannel = this.channels.generalText;
        else pollChannel = await chooseChannel('What channel should the poll go to?', this.channels.textChannels, channel, userId);

        pollChannel.send(qEmbed).then(msg => {
            poll.responses.forEach((value, key) => msg.react(key));
        });

        winston.loggers.get(this.guild.id).event(`Activity named ${this.name} sent a poll with title: ${poll.title} and question ${poll.question}.`, { event: 'Workshop' });
    }


    /**
     * Will send all the consoles the workshop needs to work.
     * @param {CommandoClient} client 
     */
    sendConsoles(client) {
        let mentorColor = randomColor();

        const TAInfoEmbed = new MessageEmbed()
            .setTitle('TA Information')
            .setDescription('Please read this before the workshop starts!')
            .addField('Create Private Channels', 'If you can only see one voice channel called activity room, go to the staff console and add voice channels to this activity.')
            .addField('Keep Track Of', '* The wait list will update but won\'t notify you about it. Keep an eye on it!\n *The activity-banter channel for any questions!')
            .addField('Low Tech Solution', '* React to this message with 🤡 to enable the low tech solution! \n* This solution will disable the public voice channel ' +
            ' and disable the pull in functionality. \n* TAs will have to DM hackers that need help and then react to the wait list.')
            .setColor(mentorColor);
        this.TAConsole.send(TAInfoEmbed).then(message => this.TAInfoEmbedHandler(message));
        
        const pollingAndStampConsoleEmbed = new MessageEmbed()
            .setColor(mentorColor)
            .setTitle('Polling and Stamp Console')
            .setDescription('Here are some common polls you might want to use!')
            .addField('Stamp Distribution', '📇 Will activate a stamp distribution that will be open for ' + this.botGuild.stamps.stampCollectionTime + ' seconds.')
            .addField('Speed Poll', '🏎️ Will send an embedded message asking how the speed is.')
            .addField('Difficulty Poll', '🎓 Will send an embedded message asking how the difficulty is.')
            .addField('Explanation Poll', '🧑‍🏫 Will send an embedded message asking how good the explanations are.');
        this.TAConsole.send(pollingAndStampConsoleEmbed).then(message => this.pollingAndStampHandler(message, client));
        
        // embed message for TA console
        const incomingTicketsEmbed = new MessageEmbed()
            .setColor(mentorColor)
            .setTitle('Hackers in need of help waitlist')
            .setDescription('* Make sure you are on a private voice channel not the general voice channel \n* To get the next hacker that needs help click 🤝');
        this.TAConsole.send(incomingTicketsEmbed).then(message => this.incomingTicketsHandler(message));

        // where users can request assistance
        const outgoingTicketEmbed = new MessageEmbed()
            .setColor(this.botGuild.colors.embedColor)
            .setTitle(this.name + ' Help Desk')
            .setDescription('Welcome to the ' + this.name + ' help desk. There are two ways to get help explained below:')
            .addField('Simple or Theoretical Questions', 'If you have simple or theory questions, ask them in the main banter channel!')
            .addField('Advanced Question or Code Assistance', 'If you have a more advanced question, or need code assistance, click the 🧑🏽‍🏫 emoji for live TA assistance! Join the ' +  Activity.mainVoiceChannelName + ' voice channel if not already there!');
        this.assistanceChannel.send(outgoingTicketEmbed).then(message => this.outgoingTicketHandler(message));
    }

    /**
     * Creates and handles with the emoji reactions on the incoming ticket console embed
     * @param {Message} message 
     */
    incomingTicketsHandler(message) {
        message.pin();
        message.react('🤝');

        this.waitListEmbedMsg = message;

        // add reaction to get next in this message!
        const getNextCollector = message.createReactionCollector((reaction, user) => !user.bot && reaction.emoji.name === '🤝');

        getNextCollector.on('collect', async (reaction, user) => {
            // remove the reaction
            reaction.users.remove(user.id);

            // check that there is someone to help
            if (this.waitlist.size === 0) {
                this.TAConsole.send('<@' + user.id + '> No one to help right now!').then(msg => msg.delete({ timeout: 5000 }));
                return;
            }

            // if pullInFunctionality is turned off then then just remove from list
            if (this.isLowTechSolution) {
                // remove hacker from wait list
                var hackerKey = this.waitlist.firstKey();
                this.waitlist.delete(hackerKey);

            } else {
                // grab the ta and their voice channel
                var ta = message.guild.member(user.id);
                var taVoice = ta.voice.channel;

                // check that the ta is in a voice channel
                if (taVoice === null || taVoice === undefined) {
                    this.TAConsole.send('<@' + user.id + '> Please join a voice channel to assist hackers.').then(msg => msg.delete({ timeout: 5000 }));
                    return;
                }

                // get next user
                var hackerKey = this.waitlist.firstKey();
                this.waitlist.delete(hackerKey);
                var hacker = message.guild.member(hackerKey);

                // if status mentor in use there are no hackers in list
                if (hacker === undefined) {
                    this.TAConsole.send('<@' + user.id + '> There are no hackers in need of help!').then(msg => msg.delete({ timeout: 5000 }));
                    return;
                }

                try {
                    await hacker.voice.setChannel(taVoice);
                    sendMessageToMember(hacker, 'TA is ready to help you! You are with them now!', true);
                    this.TAConsole.send('<@' + user.id + '> A hacker was moved to your voice channel! Thanks for your help!!!').then(msg => msg.delete({ timeout: 5000 }));
                } catch (err) {
                    sendMessageToMember(hacker, 'A TA was ready to talk to you, but we were not able to pull you to their voice ' +
                        'voice channel. Try again and make sure you are in the general voice channel!');
                    this.TAConsole.send('<@' + user.id + '> We had someone that needed help, but we were unable to move them to your voice channel. ' +
                        'They have been notified and skipped. Please help someone else!').then(msg => msg.delete({ timeout: 8000 }));
                }
            }

            // remove hacker from the embed list
            this.waitListEmbedMsg.edit(this.waitListEmbedMsg.embeds[0].spliceFields(0, 1));
        });
    }

    /**
     * Creates and handles with the emoji reactions on the outgoing ticket console embed
     * @param {Message} message 
     */
    outgoingTicketHandler(message) {
        message.pin();
        message.react('🧑🏽‍🏫');

        // filter collector and event handler for help emoji from hackers
        const helpCollector = message.createReactionCollector((reaction, user) => !user.bot && reaction.emoji.name === '🧑🏽‍🏫');

        helpCollector.on('collect', async (reaction, user) => {
            // remove the emoji
            reaction.users.remove(user.id);

            // check that the user is not already on the wait list
            if (this.waitlist.has(user.id)) {
                sendMessageToMember(user, 'You are already on the TA wait list! A TA will get to you soon!', true);
                return;
            } else {
                var position = this.waitlist.size;
                // add user to wait list
                this.waitlist.set(user.id, user.username);
            }

            let oneLiner = (await messagePrompt({prompt: 'Please send to this channel a one-liner of your problem or question. You have 20 seconds to respond', channel: this.assistanceChannel, userId: user.id })).cleanContent;

            const hackerEmbed = new MessageEmbed()
                .setColor(this.botGuild.colors.embedColor)
                .setTitle('Hey there! We got you signed up to talk to a TA!')
                .setDescription('You are number: ' + position + ' in the wait list.')
                .addField(!this.isLowTechSolution ? 'JOIN THE VOICE CHANNEL!' : 'KEEP AN EYE ON YOUR DMs', 
                    !this.isLowTechSolution ? 'Sit tight in the voice channel. If you are not in the voice channel when its your turn you will be skipped, and we do not want that to happen!' :
                        'A TA will reach out to you soon via DM! Have your question ready and try to keep up with the workshop until then!');

            sendMessageToMember(user, hackerEmbed);

            // update message embed with new user in list
            this.waitListEmbedMsg.edit(this.waitListEmbedMsg.embeds[0].addField(user.username, '<@' + user.id + '> has the question: ' +  oneLiner));
            
            // send a quick message to let ta know a new user is on the wait list
            this.TAConsole.send('A new hacker needs help!').then(msg => msg.delete({timeout: 3000}));
        });
    }

    /**
     * Creates and handles the emoji reactions on the polling and stamp console Embed 
     * @param {Message} message 
     * @param {CommandoClient} client
     */
    pollingAndStampHandler(message, client) {
        message.pin();

        var emojis = ['📇', '🏎️', '🎓', '🧑‍🏫'];

        emojis.forEach(emoji => message.react(emoji));

        const collector = message.createReactionCollector((reaction, user) => !user.bot && emojis.includes(reaction.emoji.name));

        collector.on('collect', async (reaction, user) => {
            var commandRegistry = client.registry;

            // emoji name
            var emojiName = reaction.emoji.name;

            // remove new reaction
            reaction.users.remove(user.id);

            if (emojiName === emojis[0]) {
                if (this.botGuild.stamps.isEnabled) commandRegistry.findCommands('distribute-stamp', true)[0].runCommand(this.botGuild, message, { timeLimit: this.botGuild.stamps.stampCollectTime });
                else sendMsgToChannel(message.channel, user.id, 'The distribute stamp command is not available because stamps are disabled in this server.');
            } else if (emojiName === emojis[1]) {
                commandRegistry.findCommands('workshop-polls', true)[0].runCommand(this.botGuild, message, this, { questionType: 'speed' });
            } else if (emojiName === emojis[2]) {
                commandRegistry.findCommands('workshop-polls', true)[0].runCommand(this.botGuild, message, this, { questionType: 'difficulty'});
            } else if (emojiName === emojis[3]) {
                commandRegistry.findCommands('workshop-polls', true)[0].runCommand(this.botGuild, message, this, { questionType: 'explanations'});
            }
        });
    }

    /**
     * Creates and handles the emoji reactions on the TAInfo console Embed 
     * @param {Message} message 
     */
    TAInfoEmbedHandler(message) {
        const lowTechSolutionEmoji = '🤡';

        message.pin();
        message.react(lowTechSolutionEmoji);

        message.awaitReactions((reaction, user) => !user.bot && reaction.emoji.name === lowTechSolutionEmoji, {max: 1}).then(collected => {
            // hide all voice channels

            this.isLowTechSolution = true;

            // let TAs know about the change!
            this.TAConsole.send('Low tech solution has been turned on!');
            message.edit(message.embeds[0].addField('Low Tech Solution Is On', 'To give assistance: \n* Send a DM to the highers member on the wait list \n* Then click on the emoji to remove them from the list!'));
            this.assistanceChannel.send(new MessageEmbed().setColor(this.botGuild.colors.embedColor).setTitle('Quick Update!').setDescription('You do not need to join a voice channel. TAs will send you a DM when they are ready to assist you!'));
        });
    }
}

module.exports = Workshop;