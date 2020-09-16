// Discord.js commando requirements
const { Command } = require('discord.js-commando');
const firebaseServices = require('../../firebase-services');
const discordServices = require('../../discord-services');

// Command export
module.exports = class RemoveWorkshop extends Command {
    constructor(client) {
        super(client, {
            name: 'removeworkshop',
            group: 'a_workshop',
            memberName: 'remove a workshop',
            description: 'Will remove the category and everything inside for the given workshop.',
            guildOnly: true,
            args: [
                {
                    key: 'workshopName',
                    prompt: 'the workshop name',
                    type: 'string',
                },
            ],
        });
    }

    // Run function -> command body
    async run(message, {workshopName}) {
        message.delete();
        // make sure command is only used in the admin console
        if (discordServices.isAdminConsole(message.channel) === true) {
            // only memebers with the Hacker tag can run this command!
            if (discordServices.checkForRole(message.member, discordServices.staffRole)) {
                
                // Create category
                var category = await message.guild.channels.cache.find(channel => channel.name === workshopName);
                await category.children.forEach(channel => channel.delete());
                category.delete().catch(console.error);

                // create workshop in db
                firebaseServices.removeWorkshop(workshopName);

                // report success of workshop creation
                message.reply('Workshop session named: ' + workshopName + ' removed succesfully!');
            } else {
                discordServices.replyAndDelete(message, 'You do not have permision for this command, only admins can use it!');
            }
        } else {
            discordServices.replyAndDelete(message, 'This command can only be used in the admin console!');
        }
    }

};