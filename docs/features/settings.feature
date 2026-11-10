Feature: Settings
  As a signed-in user
  I want to configure how many articles are kept and how pages are extracted
  So that the reader fits my environment

  Background:
    Given I am signed in
    And I open the settings page

  Scenario: Defaults for a new user
    Then the retention is 100
    And the extraction provider is "jina"
    And no Jina key is configured
    And no browser service address is configured

  Scenario Outline: Change article retention
    When I set retention to <value>
    Then <outcome>

    Examples:
      | value | outcome                                                         |
      | 30    | it is saved                                                     |
      | 300   | it is saved                                                     |
      | 29    | I see "Retention must be an integer between 30 and 300"         |
      | 301   | I see "Retention must be an integer between 30 and 300"         |
      | 50.5  | I see "Retention must be an integer between 30 and 300"         |

  Scenario: Use Jina without a key
    When I choose the "jina" provider and leave the key empty
    Then it is saved
    And pages are fetched anonymously

  Scenario: Save a Jina key
    When I enter a Jina key
    Then it is saved
    And the settings show that a key is configured without revealing it

  Scenario: Reject an invalid Jina key
    When I enter a key that contains line breaks or exceeds 2048 characters
    Then I see "Enter a valid Jina API key"

  Scenario: Clear the Jina key
    Given a Jina key is configured
    When I clear it
    Then no key is configured

  Scenario: Browser provider requires an address
    Given no browser service address is saved
    When I choose the "browser" provider
    Then I see "Browser service address is required"
    And the provider is not changed

  Scenario Outline: Browser address format
    When I save the browser service address "<address>"
    Then <outcome>

    Examples:
      | address                 | outcome                                              |
      | http://localhost:9222   | it is saved                                          |
      | ws://localhost:9222/x   | it is saved                                          |
      | ftp://host              | I see "Enter a valid browser service address"        |
      | not a url               | I see "Enter a valid browser service address"        |

  Scenario: Clear the browser address
    Given a browser service address is saved
    When I clear it
    Then no address is configured

  Scenario: Switching providers keeps saved configuration
    Given I configured both a Jina key and a browser address
    When I switch the provider
    Then both configurations are still saved
    And already extracted articles are kept

  Scenario: Reject an unknown provider
    When I submit a provider other than "jina" or "browser"
    Then I see "Choose a valid extraction provider"

  Scenario: Settings are per user
    Given another user changed their settings
    Then my settings are unchanged
