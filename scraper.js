const FirecrawlApp = require('@mendable/firecrawl-js').default;
const { Pool } = require('pg');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { parse } = require('date-fns');

// Enhanced date parser with multiple format support (including Indian formats)
const parseDateEnhanced = (dateStr) => {
  const cleanStr = dateStr.replace(/&nbsp;|—|\\n|\s+/g, ' ').trim();
  if (!cleanStr || cleanStr.match(/open|throughout/i)) return 'Rolling Deadline';

  const formats = [
    'dd-MM-yyyy',    // e.g., "25-11-2024"
    'dd/MM/yyyy',    // e.g., "31/01/2025"
    'MMMM dd, yyyy', // e.g., "November 25, 2024"
    'MM/dd/yyyy'     // American-style dates
  ];

  for (const fmt of formats) {
    try {
      const d = parse(cleanStr, fmt, new Date());
      if (!isNaN(d)) return d.toISOString();
    } catch {
      continue;
    }
  }
  return cleanStr;
};

// Enhanced link extraction with URL validation
const extractLinkEnhanced = (element) => {
  const baseUrl = 'https://vit.ac.in';
  const anchor = element.querySelector('a');
  if (!anchor) return null;
  const href = (anchor.getAttribute('href') || '')
    .replace(/\\n|\s+/g, '')
    .trim();
  if (!href) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return `${baseUrl}${href.startsWith('/') ? href : `/${href}`}`;
  }
};

const app = new FirecrawlApp({
  apiKey: 'fc-22a6d53819e34fcd9fe2ff7ffa58be05' // Replace with your actual API key
});

const scrapeProposals = async () => {
  try {
    // Scrape the page (waiting 20 seconds for full content)
    const result = await app.scrapeUrl('https://vit.ac.in/research/call-for-proposals', {
      formats: ['rawHtml'],
      onlyMainContent: true,
      waitFor: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!result.success) {
      throw new Error(`Firecrawl error: ${result.error}`);
    }
    
    const htmlContent = (result.data && result.data.rawHtml) || result.rawHtml;
    if (!htmlContent) throw new Error("No HTML content found");

    // Optionally save the raw HTML for debugging
    fs.writeFileSync('debug-raw-content.html', htmlContent);

    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;
    let proposals = [];

    // Process all relevant tables on the page
    const tables = document.querySelectorAll('table.wikitable, table.data-table, table');
    tables.forEach(table => {
      const rows = table.querySelectorAll('tr');
      if (rows.length < 2) return; // Skip if no data rows

      // Extract header texts from the first row
      const headerRow = rows[0];
      const headers = Array.from(headerRow.querySelectorAll('th')).map(h =>
        h.textContent.trim().toLowerCase()
      );
      
      // Map columns based on header text; fallback to default indices if necessary
      let columnIndices = {
        title: headers.findIndex(h => h.match(/scheme|title|name/i)),
        agency: headers.findIndex(h => h.includes('agency')),
        fromDate: headers.findIndex(h => h.includes('from')),
        deadline: headers.findIndex(h => h.match(/to|deadline/i)),
        link: headers.findIndex(h => h.includes('link'))
      };
      if (columnIndices.title === -1 || columnIndices.agency === -1 ||
          columnIndices.deadline === -1 || columnIndices.link === -1) {
        columnIndices = { title: 0, agency: 1, fromDate: 2, deadline: 3, link: 4 };
      }

      const dataRows = Array.from(rows).slice(1);
      const tableProposals = dataRows.map(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < 5) return null;
        return {
          title: cells[columnIndices.title]?.textContent?.replace(/\\n/g, ' ').trim() || 'Untitled',
          agency: cells[columnIndices.agency]?.textContent?.trim() || 'Unknown Agency',
          fromDate: parseDateEnhanced(cells[columnIndices.fromDate]?.textContent || ''),
          deadline: parseDateEnhanced(cells[columnIndices.deadline]?.textContent || ''),
          link: extractLinkEnhanced(cells[columnIndices.link]) || 'Link Not Available'
        };
      }).filter(Boolean);
      
      proposals = proposals.concat(tableProposals);
    });

    // Output the proposals as a clean JSON array
    console.log(JSON.stringify(proposals, null, 2));

    // Database operations: drop & create table then insert proposals
    if (proposals.length > 0) {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      
      try {
        await pool.query('BEGIN');
        await pool.query('DROP TABLE IF EXISTS proposals');
        await pool.query(`
          CREATE TABLE proposals (
            title TEXT,
            agency TEXT,
            from_date TEXT,
            deadline TEXT,
            link TEXT
          );
        `);
        
        const placeholders = proposals.map((_, i) =>
          `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`
        ).join(',');
        const values = proposals.flatMap(p => [
          p.title,
          p.agency,
          p.fromDate,
          p.deadline,
          p.link
        ]);

        await pool.query(
          `INSERT INTO proposals(title, agency, from_date, deadline, link)
           VALUES ${placeholders}`,
          values
        );
        
        await pool.query('COMMIT');
      } catch (dbError) {
        await pool.query('ROLLBACK');
        console.error('Database Error:', dbError);
        throw dbError;
      } finally {
        await pool.end();
      }
    }
  } catch (error) {
    console.error('❌ Critical Error:', error);
    fs.writeFileSync('error.log', `${new Date().toISOString()}\n${error.stack}`);
    throw error;
  }
};

scrapeProposals().catch(console.error);
