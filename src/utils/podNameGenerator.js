const adjectives = ['Cosmic', 'Wobbly', 'Sneaky', 'Fluffy', 'Ancient', 'Spicy',
    'Turbulent', 'Sleepy', 'Mighty', 'Suspicious', 'Crispy', 'Legendary',
    'Chaotic', 'Grumpy', 'Radiant'];
const nouns = ['Narwhal', 'Waffle', 'Biscuit', 'Goblin', 'Noodle', 'Penguin',
    'Pickle', 'Wizard', 'Bandit', 'Crumpet', 'Hedgehog', 'Muffin',
    'Rascal', 'Toaster', 'Crouton', 'Salamander', 'Bumblebee', 'Porcupine',
    'Turnip', 'Thundercloud'];

function getRandomPodName() {
    const adj  = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj} ${noun} Pod`;
}
module.exports = { getRandomPodName };
