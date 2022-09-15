const fs = require('node:fs');
const path = require('node:path');
const webfont = require('webfont');

async function generateFont() {
	try {
		const result = await webfont.webfont({
			files: [path.join(__dirname, '..', 'media', 'xo-logo.svg')],
			formats: ['woff'],
			verbose: true,
			fontHeight: 5000,
			normalize: true,
			fontName: 'xo',
			fontStyle: 'normal',
			fontWeight: 400
		});
		const dest = path.join(__dirname, 'xo.woff');
		fs.writeFileSync(dest, result.woff, 'binary');
		console.log(`Font created at ${dest}`);
	} catch (error) {
		console.error('Font creation failed.', error);
	}
}

generateFont();
