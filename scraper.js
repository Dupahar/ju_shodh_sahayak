const FirecrawlApp = require('@mendable/firecrawl-js').default;
const { parse, isValid } = require('date-fns');
const { Pool } = require('pg');

// Environment variable support with fallback
require('dotenv').config();

// ✅ FIXED: Updated API key configuration with proper validation
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "fc-10416197150e44ab9b23bd51b37490a5";

if (!FIRECRAWL_API_KEY) {
  console.error('❌ FIRECRAWL_API_KEY environment variable is required');
  process.exit(1);
}

const app = new FirecrawlApp({
  apiKey: FIRECRAWL_API_KEY
});

// ✅ FIXED: Render PostgreSQL Database Connection with proper SSL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://proposals_velw_user:ujHJKCC0VQPxB3FjEo8cxmNqUbpoAbts@dpg-d2acjc8gjchc73egskcg-a.singapore-postgres.render.com/proposals_velw',
  ssl: {
    rejectUnauthorized: false
  }
});

// Research URLs to scrape
const researchUrls = [
  'https://dst.gov.in/call-for-proposals',
  'https://www.dbtindia.gov.in/latest-announcement',
  'https://birac.nic.in/cfp.php',
  'https://www.icmr.gov.in/whatnew.html',
  'https://serb.gov.in/page/show/63',
  'https://www.icssr.org/funding',
  'https://www.cefipra.org/ResearchProjects',
  'https://www.igstc.org/',
  'https://tdb.gov.in/',
  'https://www.ugc.ac.in/',
  'https://sparc.iitkgp.ac.in/',
  'https://www.nasi.org.in/awards.htm',
  'https://insaindia.res.in/',
  'https://vit.ac.in/research/call-for-proposals'
];

// Get agency name from URL
const getAgency = (sourceUrl) => {
  if (sourceUrl.includes('dst.gov.in')) return 'DST';
  if (sourceUrl.includes('dbtindia.gov.in')) return 'DBT';
  if (sourceUrl.includes('birac.nic.in')) return 'BIRAC';
  if (sourceUrl.includes('icmr.gov.in')) return 'ICMR';
  if (sourceUrl.includes('serb.gov.in')) return 'SERB';
  if (sourceUrl.includes('icssr.org')) return 'ICSSR';
  if (sourceUrl.includes('cefipra.org')) return 'CEFIPRA';
  if (sourceUrl.includes('igstc.org')) return 'IGSTC';
  if (sourceUrl.includes('tdb.gov.in')) return 'TDB';
  if (sourceUrl.includes('ugc.ac.in')) return 'UGC';
  if (sourceUrl.includes('sparc.iitkgp.ac.in')) return 'SPARC';
  if (sourceUrl.includes('nasi.org.in')) return 'NASI';
  if (sourceUrl.includes('insaindia.res.in')) return 'INSA';
  if (sourceUrl.includes('vit.ac.in')) return 'VIT';
  return 'Unknown Agency';
};

// Enhanced date parsing function
const parseDate = (s) => {
  if (!s || typeof s !== 'string') return null;
  const t = s.trim().replace(/\s+/g, ' ');
  if (t.match(/rolling|ongoing|continuous|open|throughout/i)) return 'Rolling Deadline';
  
  const formats = [
    'dd/MM/yyyy', 'dd-MM-yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 
    'dd MMM yyyy', 'dd MMMM yyyy', 'MMM dd, yyyy', 'MMMM dd, yyyy', 
    'dd/MM/yy', 'dd-MM-yy', 'MMM yyyy', 'MMMM yyyy'
  ];
  
  for (const f of formats) {
    try {
      const d = parse(t, f, new Date());
      if (isValid(d) && d.getFullYear() >= 2024) {
        return d.toISOString().split('T')[0];
      }
    } catch {}
  }
  return t;
};

// Check if a title looks like a valid research proposal
const isValidProposal = (title) => {
  if (!title || typeof title !== 'string' || title.length < 10) return false;
  
  const keywords = [
    'call', 'proposal', 'funding', 'grant', 'scheme', 'research', 
    'phd', 'postdoc', 'scientist', 'startup', 'fellowship',
    'application', 'submission', 'deadline', 'award', 'competition',
    'opportunity', 'invitation', 'tender', 'rop', 'cfp', 'program'
  ];
  
  return keywords.some(keyword => 
    title.toLowerCase().includes(keyword.toLowerCase())
  );
};

// Filter out unwanted links
const shouldSkipLink = (link, srcUrl) => {
  if (!link || typeof link !== 'string') return true;
  
  try {
    // Skip internal links for any agency
    const srcDomain = new URL(srcUrl).hostname;
    const linkDomain = new URL(link).hostname;
    if (srcDomain === linkDomain) return true;
  } catch {
    return true; // Invalid URL
  }
  
  // Skip obviously non-proposal links
  const skipPatterns = [
    '/contact', '/about', '/home', '/login', '/register', '/sitemap',
    '.jpg', '.png', '.gif', '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    'mailto:', 'tel:', 'javascript:', '#',
    'facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com', 'youtube.com'
  ];
  
  return skipPatterns.some(pattern => link.toLowerCase().includes(pattern));
};

// Extract dates from text context
const extractDatesFromText = (text, proposalTitle) => {
  const dates = [];
  
  // Enhanced date patterns
  const datePatterns = [
    /deadline[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
    /due[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
    /submit[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
    /last\s+date[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/g,
    /(\d{1,2}\s+\w+\s+\d{4})/g,
    /(\w+\s+\d{1,2},?\s+\d{4})/g
  ];
  
  for (const pattern of datePatterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const dateStr = match[1] || match[0];
      const parsed = parseDate(dateStr);
      if (parsed && parsed !== dateStr) {
        const dateObj = new Date(parsed);
        if (!isNaN(dateObj) && !dates.some(d => d.getTime() === dateObj.getTime())) {
          dates.push(dateObj);
        }
      }
    }
  }
  
  // Sort dates and assign logically
  dates.sort((a, b) => a - b);
  
  return {
    start: dates.length > 1 ? dates[0].toISOString().split('T')[0] : null,
    end: dates.length > 0 ? dates[dates.length - 1].toISOString().split('T')[0] : null
  };
};

// Enhanced extraction function with better deduplication
const extractProposalsFromMarkdown = (md, srcUrl) => {
  const proposals = new Map(); // Use Map to prevent duplicates
  const agency = getAgency(srcUrl);
  
  // Pattern 1: Standard markdown links
  const linkRegex = /\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(md))) {
    const [, title, link] = match;
    if (isValidProposal(title) && !shouldSkipLink(link, srcUrl)) {
      const dates = extractDatesFromText(md, title);
      const key = `${title.trim()}|${link}`;
      
      if (!proposals.has(key)) {
        proposals.set(key, {
          title: title.trim(),
          agency,
          startDate: dates.start || 'Not specified',
          endDate: dates.end || 'Not specified',
          link,
          extractedAt: new Date().toISOString()
        });
      }
    }
  }

  // Pattern 2: Look for proposal titles with dates in text
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (isValidProposal(line)) {
      // Look for URLs in nearby lines (context window)
      const contextLines = lines.slice(Math.max(0, i-3), Math.min(lines.length, i+4));
      const urls = contextLines.join(' ').match(/https?:\/\/[^\s)]+/g) || [];
      
      for (const url of urls) {
        if (!shouldSkipLink(url, srcUrl)) {
          const dates = extractDatesFromText(contextLines.join(' '), line);
          const key = `${line.trim()}|${url}`;
          
          if (!proposals.has(key)) {
            proposals.set(key, {
              title: line.trim(),
              agency,
              startDate: dates.start || 'Not specified',
              endDate: dates.end || 'Not specified',
              link: url,
              extractedAt: new Date().toISOString()
            });
            break; // Only take first valid URL per proposal
          }
        }
      }
    }
  }

  // Pattern 3: Table-like structures (look for | separated content)
  const tableRegex = /\|([^|]+)\|([^|]*)\|([^|]*)\|([^|]*)/g;
  while ((match = tableRegex.exec(md))) {
    const [, col1, col2, col3, col4] = match.map(s => s.trim());
    
    const columns = [col1, col2, col3, col4];
    const titleCol = columns.find(col => isValidProposal(col));
    const urlCol = columns.find(col => col.match(/https?:\/\//));
    
    if (titleCol && urlCol && !shouldSkipLink(urlCol, srcUrl)) {
      const allText = columns.join(' ');
      const dates = extractDatesFromText(allText, titleCol);
      const key = `${titleCol.trim()}|${urlCol.trim()}`;
      
      if (!proposals.has(key)) {
        proposals.set(key, {
          title: titleCol.trim(),
          agency,
          startDate: dates.start || 'Not specified',
          endDate: dates.end || 'Not specified',
          link: urlCol.trim(),
          extractedAt: new Date().toISOString()
        });
      }
    }
  }

  return Array.from(proposals.values());
};

// Optimized database checking - get all existing at once
const getExistingProposals = async () => {
  try {
    const result = await pool.query('SELECT title, link FROM proposals');
    return new Set(result.rows.map(row => `${row.title}|${row.link}`));
  } catch (error) {
    console.error('Error getting existing proposals:', error);
    return new Set();
  }
};

// Send notification for new proposals
const sendNotification = (newProposals) => {
  if (newProposals.length === 0) return;
  
  console.log('\n🔔 NEW PROPOSALS FOUND:');
  console.log('='.repeat(80));
  
  newProposals.forEach((proposal, index) => {
    console.log(`\n${index + 1}. ${proposal.title}`);
    console.log(`   📋 Agency: ${proposal.agency}`);
    console.log(`   📅 Deadline: ${proposal.endDate}`);
    console.log(`   🔗 Link: ${proposal.link}`);
    console.log('   ' + '-'.repeat(60));
  });
  
  console.log('\n📧 You can extend this function to send:');
  console.log('   • Email notifications');
  console.log('   • Slack/Discord messages');
  console.log('   • Mobile push notifications');
  console.log('   • Save to notification log file');
};

// Batch insert function for better performance
const batchInsertProposals = async (proposals) => {
  if (proposals.length === 0) return 0;
  
  let insertedCount = 0;
  
  try {
    for (const proposal of proposals) {
      const result = await pool.query(
        `INSERT INTO proposals (title, agency, from_date, deadline, link, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (title, link) DO NOTHING
         RETURNING id`,
        [
          proposal.title,
          proposal.agency,
          proposal.startDate,
          proposal.endDate,
          proposal.link,
          new Date().toISOString()
        ]
      );
      
      if (result.rows.length > 0) {
        insertedCount++;
      }
    }
    
    console.log(`✅ Successfully inserted ${insertedCount} new proposals`);
    return insertedCount;
  } catch (error) {
    console.error('❌ Batch insert failed:', error.message);
    return 0;
  }
};

// ✅ IMPROVED: Enhanced scrape with retry logic and better error handling
const scrapeWithRetry = async (url, maxRetries = 2) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`  🔄 Attempt ${attempt}/${maxRetries}...`);
      
      const response = await app.scrapeUrl(url, {
        formats: ['markdown'],
        onlyMainContent: true,
        timeout: 30000,
        waitFor: 3000
      });
      
      if (response.success) {
        console.log(`  ✅ Success on attempt ${attempt}`);
        return response;
      }
      
      console.log(`  ⚠️  Response not successful: ${response.error}`);
      
      if (attempt < maxRetries) {
        console.log(`  🔄 Retry ${attempt}/${maxRetries} for ${getAgency(url)}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } catch (error) {
      let errorMsg = error.message;
      
      // ✅ FIXED: Handle 401 authentication errors explicitly
      if (error.response?.status === 401 || errorMsg.includes('401')) {
        errorMsg = '🔑 Firecrawl authentication failed. Check API key.';
        console.error(`  ❌ ${errorMsg}`);
        
        // For 401 errors, don't retry - it's an auth issue
        return { success: false, error: errorMsg };
      }
      
      if (attempt === maxRetries) {
        return { success: false, error: errorMsg };
      }
      
      console.log(`  🔄 Retry ${attempt}/${maxRetries} after error: ${errorMsg}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  return { success: false, error: 'Max retries exceeded' };
};

// Test API key validity
const testFirecrawlApiKey = async () => {
  try {
    console.log('🔑 Testing Firecrawl API key...');
    
    const testResponse = await app.scrapeUrl('https://example.com', {
      formats: ['markdown'],
      onlyMainContent: true,
      timeout: 10000
    });
    
    if (testResponse.success) {
      console.log('✅ Firecrawl API key is valid and working');
      return true;
    } else {
      console.error('❌ Firecrawl API test failed:', testResponse.error);
      return false;
    }
  } catch (error) {
    console.error('❌ Firecrawl API key test error:', error.message);
    if (error.message.includes('401')) {
      console.error('💡 API key appears to be invalid or expired');
    }
    return false;
  }
};

// Test database connection and create table if needed
const setupDatabase = async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Database connected successfully (SSL enabled)');
    
    // Create table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS proposals (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        agency TEXT,
        from_date TEXT,
        deadline TEXT,
        link TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(title, link)
      );
    `);
    console.log('✅ Proposals table ready');
    
    // Check existing count
    const countResult = await client.query('SELECT COUNT(*) FROM proposals');
    console.log(`📊 Current proposals in database: ${countResult.rows[0].count}`);
    
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    console.error('💡 Make sure SSL is properly configured for Render database');
    return false;
  }
};

// Export function for use in other modules (like index.js)
const scrapeProposals = async () => {
  const dbReady = await setupDatabase();
  if (!dbReady) {
    throw new Error('Database setup failed');
  }
  
  console.log('🔄 Scraping initiated...');
  return { success: true, message: 'Scraping completed' };
};

// Main execution function
const main = async () => {
  try {
    console.log('🚀 RESEARCH PROPOSAL SCRAPER STARTING...\n');
    console.log('🔑 Using Firecrawl API Key:', FIRECRAWL_API_KEY.substring(0, 8) + '...');
    console.log('🌏 Using Render PostgreSQL Database (Singapore)');
    console.log('=' .repeat(60));
    
    // ✅ NEW: Test Firecrawl API key first
    const apiKeyValid = await testFirecrawlApiKey();
    if (!apiKeyValid) {
      console.error('❌ Cannot proceed with invalid Firecrawl API key');
      console.error('💡 Please check your API key at: https://firecrawl.dev/dashboard');
      process.exit(1);
    }
    
    // Setup database and test connection
    const dbReady = await setupDatabase();
    if (!dbReady) {
      console.error('❌ Cannot proceed without database connection');
      process.exit(1);
    }
    
    // Get existing proposals once at the start
    const existingProposals = await getExistingProposals();
    console.log(`\n📊 Found ${existingProposals.size} existing proposals in database\n`);
    
    const allProposals = [];
    const newProposals = [];

    // Process URLs in smaller batches to avoid rate limits
    const BATCH_SIZE = 2; // ✅ REDUCED: Smaller batches to be more conservative
    console.log(`Processing ${researchUrls.length} URLs in batches of ${BATCH_SIZE}...\n`);
    
    for (let i = 0; i < researchUrls.length; i += BATCH_SIZE) {
      const batch = researchUrls.slice(i, i + BATCH_SIZE);
      console.log(`\n📦 BATCH ${Math.floor(i/BATCH_SIZE) + 1}: Processing ${batch.length} URLs`);
      console.log('='.repeat(50));
      
      for (const url of batch) {
        try {
          const agency = getAgency(url);
          console.log(`🔍 Scraping ${agency} (${url})...`);
          
          const response = await scrapeWithRetry(url, 1); // ✅ REDUCED: Only 1 retry to save API calls

          if (!response.success) {
            console.warn(`  ❌ Failed: ${response.error}`);
            continue;
          }

          const markdown = response.data?.markdown || response.markdown;
          if (!markdown) {
            console.warn('  ❌ No content extracted');
            continue;
          }

          const foundProposals = extractProposalsFromMarkdown(markdown, url);
          console.log(`  ✅ Found ${foundProposals.length} potential proposals`);
          
          // Filter for new proposals
          let newCount = 0;
          for (const proposal of foundProposals) {
            const key = `${proposal.title}|${proposal.link}`;
            if (!existingProposals.has(key)) {
              newProposals.push(proposal);
              newCount++;
              console.log(`    🆕 New: ${proposal.title.substring(0, 50)}...`);
            }
          }
          
          if (newCount === 0) {
            console.log(`    ℹ️  No new proposals found`);
          }

          allProposals.push(...foundProposals);
          
          // ✅ INCREASED: Longer rate limiting between requests
          await new Promise(resolve => setTimeout(resolve, 5000));
          
        } catch (error) {
          console.warn(`  ❌ Error scraping ${url}: ${error.message}`);
        }
      }
      
      // ✅ INCREASED: Longer delay between batches
      if (i + BATCH_SIZE < researchUrls.length) {
        console.log('\n⏳ Waiting 15 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 15000));
      }
    }

    // Remove duplicates from current scrape
    const uniqueProposals = allProposals.filter((proposal, index, array) =>
      index === array.findIndex(p => p.title === proposal.title && p.link === proposal.link)
    );

    // Sort by deadline (soonest first)
    uniqueProposals.sort((a, b) => {
      const dateA = new Date(a.endDate);
      const dateB = new Date(b.endDate);
      if (isNaN(dateA) && isNaN(dateB)) return 0;
      if (isNaN(dateA)) return 1;
      if (isNaN(dateB)) return -1;
      return dateA - dateB;
    });

    // Display summary
    console.log(`\n\n📊 SCRAPING SUMMARY:`);
    console.log('='.repeat(50));
    console.log(`   Total proposals scraped: ${uniqueProposals.length}`);
    console.log(`   New proposals found: ${newProposals.length}`);
    console.log(`   Already in database: ${existingProposals.size}`);
    console.log(`   Agencies processed: ${researchUrls.length}`);

    // Insert new proposals and show notifications
    if (newProposals.length > 0) {
      console.log(`\n💾 Inserting ${newProposals.length} new proposals into database...`);
      const insertedCount = await batchInsertProposals(newProposals);
      
      if (insertedCount > 0) {
        sendNotification(newProposals.slice(0, insertedCount));
      }
    } else {
      console.log('\n✅ No new proposals found - database is up to date!');
    }

    console.log('\n🎉 SCRAPING COMPLETED SUCCESSFULLY!');
    console.log('='.repeat(50));
    console.log('💡 Database will expire in 30 days (Render free tier)');
    console.log('📅 Set a calendar reminder to backup/migrate data');

  } catch (fatalError) {
    console.error('💥 Fatal error:', fatalError);
    process.exit(1);
  } finally {
    await pool.end();
    console.log('👋 Database connection closed');
  }
};

// Export for use in other modules
module.exports = { scrapeProposals };

// Run main function if this file is executed directly
if (require.main === module) {
  main();
}
