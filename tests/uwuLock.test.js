const { uwuifyText } = require('../src/utils/uwuLockUtil');

test('uwuification is deterministic and preserves functional tokens', () => {
    const input = 'Really love https://example.com/role <@123> `return role` <:roll:456>';

    expect(uwuifyText(input)).toBe(
        'Weawwy wove https://example.com/role <@123> `return role` <:roll:456>'
    );
    expect(uwuifyText(input)).toBe(uwuifyText(input));
});
