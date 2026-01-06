/**
 * Pagination Utility Tests
 * Tests reusable pagination functions
 */

const { createPaginationButtons, paginateArray, calculatePaginationMeta, handlePaginationInteraction } = require('../src/utils/paginationUtil');

// Mock Discord.js
jest.mock('discord.js', () => ({
    ButtonBuilder: jest.fn().mockImplementation(function() {
        this.setCustomId = jest.fn().mockReturnThis();
        this.setLabel = jest.fn().mockReturnThis();
        this.setStyle = jest.fn().mockReturnThis();
        this.setEmoji = jest.fn().mockReturnThis();
        this.setDisabled = jest.fn().mockReturnThis();
        return this;
    }),
    ButtonStyle: { Primary: 1 },
    ActionRowBuilder: jest.fn().mockImplementation(function() {
        this.addComponents = jest.fn().mockReturnThis();
        return this;
    }),
    MessageFlags: { Ephemeral: 64 },
    ComponentType: { Button: 2 }
}));

// Mock embeds
jest.mock('../src/utils/embeds', () => ({
    error: jest.fn((title, description) => ({ data: { title, description } }))
}));

describe('Pagination Utility', () => {
    describe('createPaginationButtons', () => {
        test('should create action row with prev/next buttons', () => {
            const row = createPaginationButtons(0, 3, 'test');

            expect(row.addComponents).toHaveBeenCalled();
        });

        test('should disable previous button on first page', () => {
            const { ButtonBuilder } = require('discord.js');

            createPaginationButtons(0, 3, 'test');

            // Get the first button (previous)
            const buttonCalls = ButtonBuilder.mock.results;
            const prevButton = buttonCalls[buttonCalls.length - 2].value; // Second to last

            expect(prevButton.setDisabled).toHaveBeenCalledWith(true);
        });

        test('should disable next button on last page', () => {
            const { ButtonBuilder } = require('discord.js');

            createPaginationButtons(2, 3, 'test');

            // Get the second button (next)
            const buttonCalls = ButtonBuilder.mock.results;
            const nextButton = buttonCalls[buttonCalls.length - 1].value; // Last

            expect(nextButton.setDisabled).toHaveBeenCalledWith(true);
        });

        test('should enable both buttons on middle pages', () => {
            const { ButtonBuilder } = require('discord.js');

            createPaginationButtons(1, 3, 'test');

            const buttonCalls = ButtonBuilder.mock.results;
            const prevButton = buttonCalls[buttonCalls.length - 2].value;
            const nextButton = buttonCalls[buttonCalls.length - 1].value;

            expect(prevButton.setDisabled).toHaveBeenCalledWith(false);
            expect(nextButton.setDisabled).toHaveBeenCalledWith(false);
        });
    });

    describe('paginateArray', () => {
        test('should split array into pages', () => {
            const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const pages = paginateArray(items, 3);

            expect(pages).toEqual([
                [1, 2, 3],
                [4, 5, 6],
                [7, 8, 9],
                [10]
            ]);
        });

        test('should handle empty arrays', () => {
            const pages = paginateArray([], 5);

            expect(pages).toEqual([]);
        });

        test('should handle single page', () => {
            const items = [1, 2, 3];
            const pages = paginateArray(items, 5);

            expect(pages).toEqual([[1, 2, 3]]);
        });

        test('should handle exact page sizes', () => {
            const items = [1, 2, 3, 4, 5, 6];
            const pages = paginateArray(items, 3);

            expect(pages).toEqual([
                [1, 2, 3],
                [4, 5, 6]
            ]);
        });
    });

    describe('calculatePaginationMeta', () => {
        test('should calculate correct metadata', () => {
            const meta = calculatePaginationMeta(50, 10, 3);

            expect(meta).toEqual({
                totalPages: 5,
                offset: 20,
                isLastPage: false,
                isFirstPage: false
            });
        });

        test('should identify first page', () => {
            const meta = calculatePaginationMeta(50, 10, 1);

            expect(meta.isFirstPage).toBe(true);
            expect(meta.isLastPage).toBe(false);
        });

        test('should identify last page', () => {
            const meta = calculatePaginationMeta(50, 10, 5);

            expect(meta.isFirstPage).toBe(false);
            expect(meta.isLastPage).toBe(true);
        });

        test('should handle single page', () => {
            const meta = calculatePaginationMeta(5, 10, 1);

            expect(meta.totalPages).toBe(1);
            expect(meta.isFirstPage).toBe(true);
            expect(meta.isLastPage).toBe(true);
        });

        test('should handle partial last page', () => {
            const meta = calculatePaginationMeta(25, 10, 3);

            expect(meta.totalPages).toBe(3);
            expect(meta.offset).toBe(20);
        });
    });

    describe('handlePaginationInteraction', () => {
        let mockCollector;
        let mockMessage;
        let mockInteraction;

        beforeEach(() => {
            mockCollector = {
                on: jest.fn(),
                listeners: {}
            };

            // Set up event emitter simulation
            mockCollector.on.mockImplementation((event, handler) => {
                mockCollector.listeners[event] = handler;
                return mockCollector;
            });

            mockMessage = {
                createMessageComponentCollector: jest.fn().mockReturnValue(mockCollector),
                edit: jest.fn().mockResolvedValue({})
            };

            mockInteraction = {
                user: { id: '123' }
            };
        });

        test('should create collector with correct timeout', async () => {
            const renderPage = jest.fn().mockResolvedValue({ data: { title: 'Page' } });

            await handlePaginationInteraction({
                message: mockMessage,
                interaction: mockInteraction,
                renderPage,
                totalPages: 3,
                customIdPrefix: 'test',
                timeout: 60000
            });

            expect(mockMessage.createMessageComponentCollector).toHaveBeenCalledWith(
                expect.objectContaining({
                    time: 60000
                })
            );
        });

        test('should register collector handlers', async () => {
            const renderPage = jest.fn().mockResolvedValue({ data: { title: 'Page' } });

            await handlePaginationInteraction({
                message: mockMessage,
                interaction: mockInteraction,
                renderPage,
                totalPages: 3
            });

            expect(mockCollector.on).toHaveBeenCalledWith('collect', expect.any(Function));
            expect(mockCollector.on).toHaveBeenCalledWith('end', expect.any(Function));
        });

        test('should remove buttons on collector end', async () => {
            const renderPage = jest.fn().mockResolvedValue({ data: { title: 'Page' } });

            await handlePaginationInteraction({
                message: mockMessage,
                interaction: mockInteraction,
                renderPage,
                totalPages: 3
            });

            // Trigger the 'end' event
            await mockCollector.listeners.end();

            expect(mockMessage.edit).toHaveBeenCalledWith({ components: [] });
        });

        test('should validate user on button click', async () => {
            const renderPage = jest.fn().mockResolvedValue({ data: { title: 'Page' } });

            await handlePaginationInteraction({
                message: mockMessage,
                interaction: mockInteraction,
                renderPage,
                totalPages: 3,
                customIdPrefix: 'test'
            });

            const mockButtonInteraction = {
                user: { id: '999' }, // Different user
                reply: jest.fn().mockResolvedValue({}),
                customId: 'test_next'
            };

            // Trigger the 'collect' event with wrong user
            await mockCollector.listeners.collect(mockButtonInteraction);

            expect(mockButtonInteraction.reply).toHaveBeenCalled();
            expect(renderPage).not.toHaveBeenCalled();
        });

        test('should navigate to next page', async () => {
            const renderPage = jest.fn()
                .mockResolvedValueOnce({ data: { title: 'Page 0' } })
                .mockResolvedValueOnce({ data: { title: 'Page 1' } });

            await handlePaginationInteraction({
                message: mockMessage,
                interaction: mockInteraction,
                renderPage,
                totalPages: 3,
                customIdPrefix: 'test'
            });

            const mockButtonInteraction = {
                user: { id: '123' }, // Same user
                update: jest.fn().mockResolvedValue({}),
                customId: 'test_next'
            };

            // Trigger the 'collect' event with next button
            await mockCollector.listeners.collect(mockButtonInteraction);

            expect(renderPage).toHaveBeenCalledWith(1); // Should render page 1
            expect(mockButtonInteraction.update).toHaveBeenCalled();
        });

        test('should navigate to previous page', async () => {
            let currentPage = 1;
            const renderPage = jest.fn().mockImplementation(async (page) => {
                currentPage = page;
                return { data: { title: `Page ${page}` } };
            });

            await handlePaginationInteraction({
                message: mockMessage,
                interaction: mockInteraction,
                renderPage,
                totalPages: 3,
                customIdPrefix: 'test'
            });

            // Start at page 1
            currentPage = 1;

            const mockButtonInteraction = {
                user: { id: '123' },
                update: jest.fn().mockResolvedValue({}),
                customId: 'test_prev'
            };

            // Trigger the 'collect' event with prev button
            await mockCollector.listeners.collect(mockButtonInteraction);

            expect(renderPage).toHaveBeenCalledWith(0); // Should render page 0
        });
    });
});
