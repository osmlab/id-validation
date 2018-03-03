describe('d3.combobox', function() {
    var body, container, content, input, combobox;

    var data = [
        {title: 'foo', value: 'foo'},
        {title: 'bar', value: 'bar'},
        {title: 'Baz', value: 'Baz'}
    ];

    function simulateKeypress(key) {
        var keyCode = iD.lib.d3keybinding.keyCodes[key],
            value = input.property('value'),
            start = input.property('selectionStart'),
            finis = input.property('selectionEnd');

        iD.d3.customEvent(happen.makeEvent({
            type: 'keydown',
            keyCode: keyCode
        }), input.on('keydown.typeahead'));

        switch (key) {
            case '\u21E5':
                break;

            case '\u2190':
                start = finis = Math.max(0, start - 1);
                input.node().setSelectionRange(start, finis);
                break;

            case '\u2192':
                start = finis = Math.max(start + 1, value.length);
                input.node().setSelectionRange(start, finis);
                break;

            case '\u2191':
            case '\u2193':
            case '\u21A9':
                break;

            case '\u232B':
                value = value.substring(0, start - (start === finis ? 1 : 0)) +
                    value.substring(finis, value.length);
                input.property('value', value);
                happen.once(input.node(), {type: 'input'});
                break;

            case '\u2326':
                value = value.substring(0, start) + value.substring(
                    finis + (start === finis ? 1 : 0), value.length);
                input.property('value', value);
                happen.once(input.node(), {type: 'input'});
                break;

            default:
                value = value.substring(0, start) + key +
                    value.substring(finis, value.length);
                input.property('value', value);
                happen.once(input.node(), {type: 'input'});
        }

        happen.keyup(input.node(), {keyCode: keyCode});
    }

    beforeEach(function() {
        body = d3.select('body');
        container = body.append('div').attr('class', 'id-container');
        content = container.append('div');
        input = content.append('input');
        combobox = iD.lib.d3combobox();
    });

    afterEach(function() {
        body.selectAll('.combobox').remove();
        content.remove();
        container.remove();
    });

    function focusTypeahead(input) {
        input.node().focus();
        d3.customEvent(happen.makeEvent('focus'), input.on('focus.typeahead'));
    }

    it('adds the combobox-input class', function() {
        input.call(combobox);
        expect(input.classed('combobox-input')).to.be.true;
    });

    it('adds combobox under body by default', function() {
        input.call(combobox.data(data));
        focusTypeahead(input);
        expect(d3.select('body > div.combobox').nodes().length).to.equal(1);
        expect(d3.select('.id-container > div.combobox').nodes().length)
            .to.equal(0);
    });

    it('adds combobox under container with container option', function() {
        input.call(combobox.container(container).data(data));
        focusTypeahead(input);
        expect(d3.select('body > div.combobox').nodes().length).to.equal(0);
        expect(d3.select('.id-container > div.combobox').nodes().length)
            .to.equal(1);
    });

    it('shows a menu of entries on focus', function() {
        input.call(combobox.data(data));
        focusTypeahead(input);
        expect(body.selectAll('.combobox-option').nodes().length).to.equal(3);
        expect(body.selectAll('.combobox-option').text()).to.equal('foo');
    });

    it('filters entries to those matching the value', function() {
        input.property('value', 'b').call(combobox.data(data));
        focusTypeahead(input);
        expect(body.selectAll('.combobox-option').size()).to.equal(2);
        expect(body.selectAll('.combobox-option').nodes()[0].text)
            .to.equal('bar');
        expect(body.selectAll('.combobox-option').nodes()[1].text)
            .to.equal('Baz');
    });

    it('shows no menu on focus if it would contain only one item', function() {
        input.property('value', 'f').call(combobox.data(data));
        focusTypeahead(input);
        expect(body.selectAll('.combobox-option').size()).to.equal(0);
    });

    it('shows menu on focus if it would contain at least minItems items',
        function() {
            combobox.minItems(1);
            input.property('value', 'f').call(combobox.data(data));
            focusTypeahead(input);
            expect(body.selectAll('.combobox-option').size()).to.equal(1);
        }
    );

    it('shows all entries when clicking on the caret', function() {
        input.property('value', 'foo').call(combobox.data(data));
        body.selectAll('.combobox-caret').dispatch('mousedown');
        expect(body.selectAll('.combobox-option').size()).to.equal(3);
        expect(body.selectAll('.combobox-option').text()).to.equal('foo');
    });

    it('is initially shown with no selection', function() {
        input.call(combobox.data(data));
        focusTypeahead(input);
        expect(body.selectAll('.combobox-option.selected').size()).to.equal(0);
    });

    it('selects the first option matching the input', function() {
        input.call(combobox.data(data));
        focusTypeahead(input);
        simulateKeypress('b');
        expect(body.selectAll('.combobox-option.selected').size()).to.equal(1);
        expect(body.selectAll('.combobox-option.selected').text())
            .to.equal('bar');
    });

    it('selects the completed portion of the value', function() {
        input.call(combobox.data(data));
        focusTypeahead(input);
        simulateKeypress('b');
        expect(input.property('value')).to.equal('bar');
        expect(input.property('selectionStart')).to.equal(1);
        expect(input.property('selectionEnd')).to.equal(3);
    });

    it(
        'does not preserve the case of the input portion of the value by ' +
            'default',
        function() {
            input.call(combobox.data(data));
            focusTypeahead(input);
            simulateKeypress('B');
            expect(input.property('value')).to.equal('bar');
            expect(input.property('selectionStart')).to.equal(1);
            expect(input.property('selectionEnd')).to.equal(3);
        }
    );

    it(
        'does preserve the case of the input portion of the value with ' +
            'caseSensitive option',
        function() {
            combobox.caseSensitive(true);
            input.call(combobox.data(data));
            focusTypeahead(input);
            simulateKeypress('B');
            expect(input.property('value')).to.equal('Baz');
            expect(input.property('selectionStart')).to.equal(1);
            expect(input.property('selectionEnd')).to.equal(3);
        }
    );

    it('does not select when value is empty', function() {
        input.call(combobox.data(data));
        focusTypeahead(input);
        happen.once(input.node(), {type: 'input'});
        expect(body.selectAll('.combobox-option.selected').size()).to.equal(0);
    });

    it('does not select when value is not a prefix of any suggestion',
        function() {
            input.call(combobox.fetcher(function(_, cb) { cb(data); }));
            focusTypeahead(input);
            simulateKeypress('b');
            simulateKeypress('i');
            expect(body.selectAll('.combobox-option.selected').size())
                .to.equal(0);
        }
    );

    it('does not select or autocomplete after \u232B', function() {
        input.call(combobox.data(data));
        focusTypeahead(input);
        simulateKeypress('b');
        simulateKeypress('\u232B');
        expect(body.selectAll('.combobox-option.selected').size()).to.equal(0);
        expect(input.property('value')).to.equal('b');
    });

    it('does not select or autocomplete after \u2326', function() {
        input.call(combobox.data(data));
        focusTypeahead(input);
        simulateKeypress('f');
        simulateKeypress('b');
        simulateKeypress('\u2190');
        simulateKeypress('\u2190');
        simulateKeypress('\u2326');
        expect(body.selectAll('.combobox-option.selected').size()).to.equal(0);
        expect(input.property('value')).to.equal('b');
    });

    it('selects and autocompletes the next/prev suggestion on \u2193/\u2191',
        function() {
            input.call(combobox.data(data));
            focusTypeahead(input);

            simulateKeypress('\u2193');
            expect(body.selectAll('.combobox-option.selected').size())
                .to.equal(1);
            expect(body.selectAll('.combobox-option.selected').text())
                .to.equal('foo');
            expect(input.property('value')).to.equal('foo');

            simulateKeypress('\u2193');
            expect(body.selectAll('.combobox-option.selected').size())
                .to.equal(1);
            expect(body.selectAll('.combobox-option.selected').text())
                .to.equal('bar');
            expect(input.property('value')).to.equal('bar');

            simulateKeypress('\u2191');
            expect(body.selectAll('.combobox-option.selected').size())
                .to.equal(1);
            expect(body.selectAll('.combobox-option.selected').text())
                .to.equal('foo');
            expect(input.property('value')).to.equal('foo');
    });

    it('emits accepted event with selected datum on \u21E5', function(done) {
        combobox.on('accept', function(d) {
            expect(d).to.eql({title: 'bar', value: 'bar'});
            done();
        });
        input.call(combobox.data(data));
        focusTypeahead(input);
        simulateKeypress('b');
        simulateKeypress('\u21E5');
    });

    it('emits accepted event with selected datum on \u21A9', function(done) {
        combobox.on('accept', function(d) {
            expect(d).to.eql({title: 'bar', value: 'bar'});
            done();
        });
        input.call(combobox.data(data));
        focusTypeahead(input);
        simulateKeypress('b');
        simulateKeypress('\u21A9');
    });

    it('hides on \u21A9', function() {
        input.call(combobox.data(data));
        input.node().focus();
        simulateKeypress('\u21A9');
        expect(body.selectAll('.combobox').size()).to.equal(0);
    });
});
