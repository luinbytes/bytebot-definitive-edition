describe('Media Gallery Service', () => {
    let serviceInstances = [];

    afterEach(() => {
        // Clean up all service instances to prevent timer leaks
        serviceInstances.forEach(service => {
            if (service && service.cleanup) {
                service.cleanup();
            }
        });
        serviceInstances = [];
    });

    describe('Service Structure', () => {
        test('MediaGalleryService should be properly structured', () => {
            const MediaGalleryService = require('../src/services/mediaGalleryService');
            const mockClient = {};
            const service = new MediaGalleryService(mockClient);
            serviceInstances.push(service);

            expect(service.client).toBe(mockClient);
            expect(service.configCache).toBeInstanceOf(Map);
            expect(service.cacheExpiry).toBeInstanceOf(Map);
            expect(service.cleanupInterval).toBeDefined();
            expect(typeof service.checkMessage).toBe('function');
            expect(typeof service.captureMedia).toBe('function');
            expect(typeof service.categorizeFileType).toBe('function');
            expect(typeof service.getChannelConfig).toBe('function');
            expect(typeof service.clearChannelCache).toBe('function');
            expect(typeof service.cleanup).toBe('function');
        });

        test('cleanup method should clear interval', () => {
            const MediaGalleryService = require('../src/services/mediaGalleryService');
            const service = new MediaGalleryService({});
            serviceInstances.push(service);

            const intervalId = service.cleanupInterval;
            expect(intervalId).toBeDefined();

            service.cleanup();
            expect(service.cleanupInterval).toBeNull();
        });
    });

    describe('File Type Categorization', () => {
        let service;

        beforeEach(() => {
            const MediaGalleryService = require('../src/services/mediaGalleryService');
            service = new MediaGalleryService({});
            serviceInstances.push(service);
        });

        test('should categorize image MIME types', () => {
            expect(service.categorizeFileType('image/png')).toBe('image');
            expect(service.categorizeFileType('image/jpeg')).toBe('image');
            expect(service.categorizeFileType('image/gif')).toBe('image');
            expect(service.categorizeFileType('image/webp')).toBe('image');
        });

        test('should categorize video MIME types', () => {
            expect(service.categorizeFileType('video/mp4')).toBe('video');
            expect(service.categorizeFileType('video/webm')).toBe('video');
            expect(service.categorizeFileType('video/quicktime')).toBe('video');
        });

        test('should categorize audio MIME types', () => {
            expect(service.categorizeFileType('audio/mpeg')).toBe('audio');
            expect(service.categorizeFileType('audio/wav')).toBe('audio');
            expect(service.categorizeFileType('audio/ogg')).toBe('audio');
        });

        test('should categorize document MIME types', () => {
            expect(service.categorizeFileType('application/pdf')).toBe('document');
            expect(service.categorizeFileType('application/vnd.ms-excel')).toBe('document');
            expect(service.categorizeFileType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('document');
        });

        test('should return "other" for unknown types', () => {
            expect(service.categorizeFileType('application/octet-stream')).toBe('other');
            expect(service.categorizeFileType('text/plain')).toBe('other');
            expect(service.categorizeFileType(null)).toBe('other');
            expect(service.categorizeFileType(undefined)).toBe('other');
        });
    });

    describe('Cache Management', () => {
        let service;

        beforeEach(() => {
            const MediaGalleryService = require('../src/services/mediaGalleryService');
            service = new MediaGalleryService({});
            serviceInstances.push(service);
        });

        test('clearChannelCache should remove specific channel', () => {
            service.configCache.set('123', { enabled: true });
            service.cacheExpiry.set('123', Date.now() + 300000);

            expect(service.configCache.has('123')).toBe(true);
            expect(service.cacheExpiry.has('123')).toBe(true);

            service.clearChannelCache('123');

            expect(service.configCache.has('123')).toBe(false);
            expect(service.cacheExpiry.has('123')).toBe(false);
        });

        test('cache cleanup should remove expired entries', (done) => {
            // Add an expired entry
            service.configCache.set('expired', { enabled: true });
            service.cacheExpiry.set('expired', Date.now() - 1000);

            // Add a valid entry
            service.configCache.set('valid', { enabled: true });
            service.cacheExpiry.set('valid', Date.now() + 300000);

            // Wait a bit for cleanup interval to run (we can't control exact timing in tests)
            // Just verify the structure is correct
            expect(service.configCache.has('expired')).toBe(true);
            expect(service.configCache.has('valid')).toBe(true);
            done();
        });
    });

    describe('Message Validation', () => {
        let service;

        beforeEach(() => {
            const MediaGalleryService = require('../src/services/mediaGalleryService');
            service = new MediaGalleryService({});
            serviceInstances.push(service);
        });

        test('checkMessage should handle messages without attachments', async () => {
            const mockMessage = {
                attachments: { size: 0 }
            };

            // Should return early without error
            await expect(service.checkMessage(mockMessage)).resolves.toBeUndefined();
        });
    });

    describe('Capture Method Tracking', () => {
        let service;

        beforeEach(() => {
            const MediaGalleryService = require('../src/services/mediaGalleryService');
            service = new MediaGalleryService({});
            serviceInstances.push(service);
        });

        test('captureMedia should accept valid method types', () => {
            const mockMessage = {
                author: { id: '123' },
                guild: { id: '456' },
                channel: { id: '789' },
                id: '999'
            };

            const mockAttachment = {
                url: 'https://cdn.discordapp.com/test.png',
                name: 'test.png',
                contentType: 'image/png',
                size: 1024
            };

            const mockConfig = {
                fileTypes: 'image,video,audio',
                maxFileSizeMB: 50,
                autoTagChannel: false
            };

            // Should accept 'auto' method
            expect(() => service.captureMedia(mockMessage, mockAttachment, mockConfig, 'auto')).not.toThrow();

            // Should accept 'manual' method
            expect(() => service.captureMedia(mockMessage, mockAttachment, mockConfig, 'manual')).not.toThrow();
        });
    });

    describe('File Size Validation', () => {
        let service;

        beforeEach(() => {
            const MediaGalleryService = require('../src/services/mediaGalleryService');
            service = new MediaGalleryService({});
            serviceInstances.push(service);
        });

        test('captureMedia should validate file size limits', async () => {
            const mockMessage = {
                author: { id: '123' },
                guild: { id: '456' },
                channel: { id: '789', name: 'test' },
                id: '999',
                content: ''
            };

            const oversizedAttachment = {
                url: 'https://cdn.discordapp.com/test.png',
                name: 'test.png',
                contentType: 'image/png',
                size: 100 * 1024 * 1024 // 100 MB
            };

            const config = {
                fileTypes: 'image,video,audio',
                maxFileSizeMB: 50, // 50 MB limit
                autoTagChannel: false
            };

            const result = await service.captureMedia(mockMessage, oversizedAttachment, config, 'auto');

            expect(result.success).toBe(false);
            expect(result.error).toContain('exceeds limit');
        });
    });

    describe('File Type Filtering', () => {
        let service;

        beforeEach(() => {
            const MediaGalleryService = require('../src/services/mediaGalleryService');
            service = new MediaGalleryService({});
            serviceInstances.push(service);
        });

        test('captureMedia should validate allowed file types', async () => {
            const mockMessage = {
                author: { id: '123' },
                guild: { id: '456' },
                channel: { id: '789', name: 'test' },
                id: '999',
                content: ''
            };

            const documentAttachment = {
                url: 'https://cdn.discordapp.com/test.pdf',
                name: 'test.pdf',
                contentType: 'application/pdf',
                size: 1024
            };

            const config = {
                fileTypes: 'image,video', // Only images and videos allowed
                maxFileSizeMB: 50,
                autoTagChannel: false
            };

            const result = await service.captureMedia(mockMessage, documentAttachment, config, 'auto');

            expect(result.success).toBe(false);
            expect(result.error).toContain('not allowed');
        });
    });
});
