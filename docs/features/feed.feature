# Reference scenarios for the Feed domain. Spec: docs/usecases/feed.md
# Scenarios tagged @ui describe front-end behavior; @system behavior with no user action;
# @boundary parsing and shaping at the HTTP edge.
Feature: Feeds and their items

  Background:
    Given I am signed in

  # FD-PREVIEW
  Scenario: Preview before subscribing
    When I enter a feed address and ask for a preview
    Then I see the feed title, its description if any, and the titles of its entries
    And nothing is subscribed or stored

  # FD-PREVIEW-2
  Scenario Outline: A preview that fails
    When I preview an address and <problem>
    Then I see the reason
    And nothing is stored

    Examples:
      | problem                |
      | it cannot be fetched   |
      | it is not a valid feed |

  # FD-PREVIEW-3, FD-SUB
  @boundary
  Scenario: The subscription title comes back from the client
    Given a preview showed the title "Example"
    When I subscribe sending that title back
    Then the feed is stored with the title "Example"

  # FD-SUB
  @boundary
  Scenario: A blank subscription title becomes the host
    When I subscribe sending a blank title
    Then the feed is stored with the URL's host as its title

  # FD-SUB
  Scenario: Subscribing returns at once with no articles
    Given I confirm the subscription to a feed that lists articles
    Then I get the feed at once
    And it has no articles yet

  # FD-SUB
  @system
  Scenario: The articles arrive after the first refresh
    Given I subscribed to a feed
    When the feed is refreshed for the first time
    And I list its articles again
    Then I see the articles the source lists

  # FD-SUB-1, FD-ID-1
  Scenario: Subscribe to a feed I already follow
    Given I follow "https://example.com/feed.xml"
    When I subscribe to "https://example.com/feed.xml?utm_source=x#top"
    Then I am told the feed exists, naming the normalized URL "https://example.com/feed.xml"
    And nothing is fetched

  # FD-SUB-2
  Scenario: Two requests subscribe to the same feed at once
    When two requests subscribe to the same address at the same moment
    Then one feed exists for that URL
    And the other request is told the feed exists, naming the URL

  # FD-SUB-3
  @system
  Scenario: The source title replaces the preview title
    Given I subscribed to a feed with the preview title "Example"
    When the feed refreshes successfully for the first time
    Then the feed's title is the source's title

  # FD-SUB-4
  Scenario: A feed with no entries
    When I subscribe to a feed that lists nothing
    Then the subscription is created with no articles
    And every refresh succeeds and imports nothing

  # FD-SUB-5
  @system
  Scenario: An address that is not a feed
    When I subscribe to an address that is not a feed
    Then the feed is created with no articles
    And every refresh logs a failure

  # FD-ID-2
  @system
  Scenario: Items are identified by their URL
    Given a feed item was imported and I read it
    When the source changes its title
    And the feed is refreshed
    Then there is still one item
    And it is still read

  # FD-ID-3
  @system
  Scenario: The same article in two feeds
    Given two of my feeds list the same URL
    Then I have two articles, one in each feed
    And reading one leaves the other unread

  # FD-IMPORT-7
  @system
  Scenario: An entry without a link is not imported
    When a source lists an entry without a link
    And the feed is refreshed
    Then that entry is not imported
    And the other entries are imported

  # FD-SEL-1
  @system
  Scenario: The first import follows my retention
    Given my retention setting is 30
    And a feed lists 100 entries
    When the feed is refreshed for the first time
    Then the first 30 entries it lists are imported

  # FD-SEL-1, FD-ID-2
  @system
  Scenario: A duplicate entry is imported once and counts once
    Given my retention setting is 30
    And the source lists the same URL twice, followed by 29 other articles
    When the feed is refreshed for the first time
    Then the article is imported once
    And 30 articles are stored

  # FD-SEL-3
  @system
  Scenario: A new article arrives on top and the bottom one is removed
    Given my retention setting is 30
    And a feed stores 30 articles
    When the source lists one new article first, followed by the 30 stored ones in their current list order
    And the feed is refreshed successfully
    Then the feed stores 30 articles
    And the new article is at the top
    And the article that was at the bottom is removed

  # FD-SEL-3
  @system
  Scenario: A short source keeps the newest stored articles up to N
    Given my retention setting is 30
    And a feed stores 30 articles
    When the source lists only one article that is not stored
    And the feed is refreshed successfully
    Then the feed stores that article and the 29 newest stored articles
    And the oldest stored article is removed

  # FD-SEL-4
  @system
  Scenario: Unread articles are removed like read ones
    Given my retention setting is 30
    And a feed stores 30 articles, and the oldest one is unread
    When the source lists 30 articles that are not stored
    And the feed is refreshed successfully
    Then the unread article is removed

  # FD-IMPORT-6, FD-SEL-3
  @system
  Scenario: One entry that cannot be cleaned
    Given my retention setting is 30
    And the source lists 30 entries and one of them cannot be cleaned
    When the feed is refreshed for the first time
    Then the other 29 entries are imported
    And the bad entry is tried again at the next refresh
    And the feed stores 29 articles until it imports

  # FD-SEL-5
  @system
  Scenario: An article the source dropped stays
    Given my retention setting is 30
    And a feed stores 10 articles
    When the source stops listing one of them
    And the feed is refreshed successfully
    Then the article stays

  # FD-SEL-7
  Scenario: Lowering retention trims at the next refresh only
    Given my retention setting is 100
    And a feed stores 100 articles
    When I set my retention to 30
    Then the feed still stores 100 articles
    When the feed refreshes
    Then the feed stores 30 articles

  # FD-SYNC-1
  @system
  Scenario: Stored articles are not updated from the source
    Given an article is stored
    When the source corrects its content
    And the feed refreshes
    Then the stored article keeps its first content

  # FD-SYNC-2
  @system
  Scenario: A refresh interrupted between writes
    Given my retention setting is 30
    And a feed stores 30 articles
    When the source lists 5 new articles first and all 5 are imported
    And the trim step fails
    Then the feed holds 35 articles
    And it keeps its old title and its old updatedAt
    And after the next successful refresh it holds 30 articles

  # FD-SCHED-1, FD-SCHED-2, FD-SCHED-3, FD-SCHED-6
  @system
  Scenario: Every feed refreshes on the interval
    Given I have feeds
    Then every feed is enqueued every refresh interval, 30 minutes by default
    And every feed is enqueued once at process start
    And each run is subject to the refresh queue

  # FD-SCHED-2
  @system
  Scenario Outline: A request for a feed that already has a refresh
    Given a feed has <state>
    When that feed is requested again several times
    Then the requests are dropped, so no second refresh is added
    And <result>

    Examples:
      | state                                | result                              |
      | a refresh running                    | the running refresh ends on its own |
      | a refresh queued and not yet running | the queued refresh runs once        |

  # FD-SCHED-3
  @system
  Scenario: Feeds of one owner refresh at the same time
    Given I have two feeds that are due
    When the first feed's fetch is still in progress
    Then the second feed of mine starts its fetch

  # FD-SCHED-4, FD-SCHED-5
  @system
  Scenario: A failed refresh is logged and not shown
    Given one of my feeds cannot be fetched
    Then the failure is logged
    And the other feeds still refresh
    And I am not shown the failure

  # FD-SCHED-7
  @system
  Scenario: A new subscription is refreshed right away
    When I subscribe to a feed
    Then the new feed is enqueued for refresh at once
    And I get it before it has any articles
    And no user operation refreshes a feed from its source

  # FD-REFRESH-1, FD-SYNC-5
  Scenario: A feed removed during its refresh
    Given the fetch, the parse and the storage of the refresh all succeed
    When a feed is unsubscribed while its refresh is running
    Then the refresh ends without an error
    And no articles of that feed remain

  # FD-UNSUB-5, FD-SYNC-5
  Scenario: Subscribing again while the old refresh still runs
    Given a feed is unsubscribed while its refresh is running
    When I subscribe to the same address again
    Then I get a new feed with a new id, not the old one
    And its own refresh is queued for it
    And the running refresh of the old feed creates no articles
    And the new feed's articles come from its own refresh

  # FD-REFRESH-1, FD-SCHED-4
  @system
  Scenario: A feed removed during its refresh and the fetch fails
    Given a feed is unsubscribed while its refresh is running
    When the fetch of that refresh fails
    Then the failure is logged

  # FD-LIST-1, FD-LIST-4
  Scenario: List articles from all my feeds
    When I open the subscription list
    Then I see articles from all my feeds, newest first
    And articles imported in the same refresh are in source order

  # FD-LIST-4
  Scenario: One feed's list is the all-feeds list filtered
    Given the all-feeds list shows articles of several feeds in one order
    When I list one feed
    Then I see that feed's articles in the same order
    And no article of another feed

  # FD-LIST-2
  Scenario: Select a feed that does not exist
    When I list the articles of a feed that is gone or not mine
    Then I get an empty list, and it is not an error

  # CM-PAGE-8
  Scenario: Show only unread
    When I show only unread
    Then I see only unread articles

  # CM-PAGE-4
  Scenario: Page through the articles
    Given I have more articles than one page holds
    When I list with a page size and then with the returned cursor
    Then I get the following articles without repeats

  # FD-LIST-5, CM-PAGE-4
  Scenario: Paging while a refresh of the same feed adds articles
    Given I am paging through the articles of one feed
    When the source lists new articles and a refresh of that feed adds them
    And I continue with the returned cursor
    Then no article that stays stored is repeated or skipped
    And the new articles appear when I list again from the first page

  # CM-PAGE-4
  Scenario: The last page has no cursor
    Given the remaining articles fit on one page
    When I list them with a page size
    Then I get all of them and the page has no cursor

  # CM-PAGE-4
  Scenario: Exactly one full page gives no cursor
    Given exactly one page of articles remains
    When I list them with that page size
    Then I get all of them and the page has no cursor

  # CM-PAGE-7
  Scenario: Changing feed or filter starts over
    Given I am paging through all feeds
    When I select one feed
    Then I list again from the first page without a cursor

  # FD-LIST-3
  Scenario: Feeds are listed by title
    Then my feeds are listed by title, then id

  # FD-IMPORT-5
  Scenario: An article shows the publish time its source gives
    When an entry dated 2026-03-01 10:00 UTC is imported
    Then the article shows that date

  # FD-IMPORT-5, FD-LIST-4
  Scenario: A future publish time does not move the article
    When an entry dated in the future is imported
    Then its date is the time the source gave
    And it is listed in arrival order, newest first, not by that date

  # FD-IMPORT-5
  Scenario: An article without a publish time shows no date
    When an entry that carries no publish time is imported
    Then it shows no date
    And it is listed in arrival order, newest first

  # FD-OPEN
  Scenario: Open an article
    When I open an article that exists
    Then I get it
    When I open one that does not exist or is not mine
    Then I get nothing, and it is not an error
    And no feed is looked up

  # FD-EXTRACT
  Scenario: Extract an article's page
    Given an article with no extracted content
    When I ask for the extracted view
    Then the page is fetched and its article extracted
    And the content is stored on the article

  # FD-EXTRACT-2
  Scenario: Reuse extracted content
    Given an article already has extracted content
    When I ask for the extracted view
    Then nothing is fetched

  # FD-EXTRACT-1, CM-FETCH-4
  Scenario Outline: Extraction fails
    When extraction <fails>
    Then I see the reason
    And nothing is stored

    Examples:
      | fails                                         |
      | cannot fetch the page                         |
      | cannot parse the page                         |
      | the article extractor fails (ArticleExtractorError) |
      | finds no article content                      |

  # FD-EXTRACT-2
  Scenario: Two extractions of one article at once
    Given an article with no extracted content
    And two requests find the article before either stores its result
    When the two requests extract the same article at once
    Then both fetch the page
    And each returns what it extracted
    And the content stored is the one written last

  # FD-EXTRACT
  Scenario: The article disappears while it is extracted
    When the article is removed before its extracted content is stored
    Then I am told the article was not found
    And nothing is stored

  # FD-EXTRACT
  Scenario: Extract an article that no longer exists
    When I ask for the extracted view of a missing article
    Then I am told the article was not found

  # FD-READ
  Scenario Outline: Mark articles by id
    When I mark chosen articles <state>
    Then exactly those are <state>
    And the unread count of their feed follows

    Examples:
      | state  |
      | read   |
      | unread |

  # FD-READ-4
  Scenario: Marking twice is idempotent
    Given an article is read
    When I mark it read again
    Then it is still read and nothing else changes

  # FD-READ
  Scenario: Mark a feed read
    When I mark a feed read
    Then every article of that feed is read, loaded or not

  # FD-READ-1
  Scenario: Marking unknown ids changes nothing
    When I mark ids that do not exist or are not mine
    Then nothing changes and there is no error

  # FD-READ-2
  Scenario: Feeds that are not mine are ignored
    When I mark feeds read and include a feed id that is not mine
    Then only my own feeds are affected

  # FD-READ-3
  Scenario: Mark all subscription articles read leaves saved pages alone
    Given I saved one of my feed articles to read later
    When I mark all my subscription articles read
    Then every article of every one of my feeds is read
    And the saved page keeps its own read state

  # FD-COUNT
  Scenario: Unread counts
    Given feed A has 3 unread articles and feed B has 4
    Then feed A shows 3 and feed B shows 4
    And the total is 7

  # FD-COUNT-1
  Scenario: A feed with nothing unread
    Given feed C has no unread articles
    Then feed C counts as 0

  # FD-UNSUB
  Scenario: Unsubscribe
    Given I saved one of the feed's articles to read later
    When I unsubscribe
    Then the feed and all its articles are gone
    And the unread counts no longer include it
    And the saved page stays in my read-later list

  # FD-UNSUB-2
  Scenario: Unsubscribe is idempotent
    When I unsubscribe from a feed that does not exist or is not mine
    Then nothing changes and there is no error

  # FD-OWN
  Scenario: Feeds are private
    Given another user has feeds
    Then I never see, read, mark or remove theirs

  # ---- front-end behavior (not business rules) ----

  # FD-SUB
  @ui
  Scenario: Subscribing is a preview, then a confirmation
    When I enter an address and preview it
    Then I can confirm to subscribe or go back and edit
    And after subscribing I land on the new feed

  # FD-SUB-1, CM-ID-7
  @ui
  Scenario: A feed I already follow opens
    When I subscribe to a feed I already follow
    Then the feed in my list with the URL the error names is shown

  # FD-UNSUB-3
  @ui
  Scenario: Unsubscribing asks for confirmation
    When I choose to unsubscribe
    Then I am told that saved read-later pages are kept
    And I must confirm

  # FD-READ
  @ui
  Scenario: Opening an article marks it read but keeps it listed
    Given I am viewing the unread list
    When I open an article
    Then it becomes read
    And it stays in the list, shown as read, until I reload the list

  # CM-PAGE-9
  @ui
  Scenario: The list reloads only on entering, switching or an explicit refresh
    Then the list is reloaded when I enter it, select a feed, change the filter, or press refresh
    And it is not reloaded in the background
