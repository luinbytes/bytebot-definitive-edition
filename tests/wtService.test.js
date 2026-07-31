jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../src/utils/logger', () => ({ error: jest.fn() }));

const axios = require('axios');
const wtService = require('../src/utils/wtService');

describe('War Thunder service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('rejects HTTP error responses instead of treating them as player data', async () => {
        axios.get.mockImplementation((_url, options) => {
            const accepts = (options.validateStatus || (status => status >= 200 && status < 300))(404);
            if (accepts) {
                return Promise.resolve({ status: 404, data: { detail: 'Player not found' } });
            }
            const error = new Error('Request failed with status code 404');
            error.response = { status: 404, data: { detail: 'Player not found' } };
            return Promise.reject(error);
        });

        await expect(wtService.getPlayerStats(123)).rejects.toThrow('status code 404');
    });
});
